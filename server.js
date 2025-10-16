const express = require('express');
const multer = require('multer');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const Bull = require('bull');
const morgan = require('morgan');
const logger = require('./logger');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuration
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/uploads';
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/tmp/outputs';
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE || 10 * 1024 * 1024 * 1024;
const FILE_RETENTION_HOURS = process.env.FILE_RETENTION_HOURS || 24;

logger.info('Application starting with configuration', {
  PORT,
  REDIS_URL,
  UPLOAD_DIR,
  OUTPUT_DIR,
  MAX_FILE_SIZE,
  FILE_RETENTION_HOURS,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
});

// Ensure directories exist
[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    logger.debug(`Creating directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Directory created: ${dir}`);
  } else {
    logger.debug(`Directory already exists: ${dir}`);
  }
});

// Initialize Bull queue
logger.info('Initializing Bull queue', { REDIS_URL });
const videoQueue = new Bull('video processing', REDIS_URL);

videoQueue.on('error', (error) => {
  logger.logError(error, { component: 'Bull Queue', event: 'error' });
});

videoQueue.on('waiting', (jobId) => {
  logger.debug('Job waiting in queue', { jobId, component: 'Bull Queue' });
});

videoQueue.on('active', (job) => {
  logger.info('Job started processing', { jobId: job.id, component: 'Bull Queue' });
});

videoQueue.on('completed', (job, result) => {
  logger.info('Job completed successfully', { 
    jobId: job.id, 
    outputFilename: result.outputFilename,
    fileSize: result.fileSize,
    component: 'Bull Queue' 
  });
});

videoQueue.on('failed', (job, error) => {
  logger.error('Job failed', { 
    jobId: job.id, 
    error: error.message,
    stack: error.stack,
    component: 'Bull Queue' 
  });
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(morgan('combined', { stream: logger.stream }));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
    const sessionDir = path.join(UPLOAD_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
      logger.debug('Creating session directory', { sessionId, sessionDir });
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    logger.debug('Processing uploaded file', { 
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });
    cb(null, file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.mp4', '.MP4', '.lrv', '.LRV', '.thm', '.THM'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(ext)) {
    logger.debug('File type accepted', { filename: file.originalname, ext });
    cb(null, true);
  } else {
    logger.warn('File type rejected', { filename: file.originalname, ext });
    cb(new Error(`File type ${ext} not supported`), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 50 }
});

// GoPro file parser
class GoProFileDetector {
  static parseGoProFilename(filename) {
    const goProPattern = /^G([HX])(\d{2})(\d{4})\.(MP4|LRV|THM)$/i;
    const match = filename.match(goProPattern);
    
    if (match) {
      const parsed = {
        encoding: match[1].toUpperCase(),
        chapter: parseInt(match[2], 10),
        sequence: parseInt(match[3], 10),
        extension: match[4].toUpperCase(),
        isGoPro: true
      };
      logger.debug('Parsed GoPro filename', { filename, parsed });
      return parsed;
    }
    logger.debug('File is not a GoPro file', { filename });
    return { isGoPro: false };
  }
  
  static groupFiles(files) {
    logger.debug('Grouping files', { fileCount: files.length });
    const groups = new Map();
    
    files.forEach(file => {
      const parsed = this.parseGoProFilename(file.originalname);
      
      if (parsed.isGoPro && parsed.extension === 'MP4') {
        const key = `${parsed.encoding}_${parsed.sequence}`;
        
        if (!groups.has(key)) {
          logger.debug('Creating new group', { key, sequence: parsed.sequence, encoding: parsed.encoding });
          groups.set(key, {
            sequence: parsed.sequence,
            encoding: parsed.encoding,
            chapters: []
          });
        }
        
        groups.get(key).chapters.push({
          chapter: parsed.chapter,
          filename: file.filename,
          originalname: file.originalname,
          path: file.path,
          size: file.size
        });
        logger.debug('Added file to group', { key, chapter: parsed.chapter, filename: file.originalname });
      }
    });
    
    groups.forEach(group => {
      group.chapters.sort((a, b) => a.chapter - b.chapter);
      logger.debug('Sorted group chapters', { 
        sequence: group.sequence, 
        encoding: group.encoding,
        chapterCount: group.chapters.length 
      });
    });
    
    logger.info('File grouping complete', { groupCount: groups.size });
    return Array.from(groups.values());
  }
}

// Video processing with FFmpeg
class VideoProcessor {
  static async concatenateVideos(inputFiles, outputPath, onProgress) {
    logger.info('Starting video concatenation', { 
      inputFileCount: inputFiles.length,
      outputPath 
    });
    
    return new Promise((resolve, reject) => {
      const tempListFile = path.join(path.dirname(outputPath), `filelist_${Date.now()}.txt`);
      
      try {
        const fileListContent = inputFiles
          .map(file => `file '${file.replace(/'/g, "'\\''")}'`)
          .join('\n');
        
        logger.debug('Writing FFmpeg filelist', { tempListFile, fileCount: inputFiles.length });
        fs.writeFileSync(tempListFile, fileListContent);
        
        const ffmpegArgs = [
          '-f', 'concat',
          '-safe', '0',
          '-i', tempListFile,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          outputPath
        ];
        
        logger.debug('Spawning FFmpeg process', { args: ffmpegArgs });
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        
        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
          logger.debug('FFmpeg output', { output: data.toString().trim() });
          
          const timeMatch = stderr.match(/time=([\d:.]+)/);
          if (timeMatch && onProgress) {
            logger.debug('FFmpeg progress', { time: timeMatch[1] });
            onProgress({ time: timeMatch[1], stage: 'concatenating' });
          }
        });
        
        ffmpeg.on('close', (code) => {
          logger.debug('FFmpeg process closed', { code });
          
          if (fs.existsSync(tempListFile)) {
            fs.unlinkSync(tempListFile);
            logger.debug('Cleaned up temp filelist', { tempListFile });
          }
          
          if (code === 0) {
            logger.info('Video concatenation successful', { outputPath });
            resolve({ success: true, outputPath });
          } else {
            logger.error('FFmpeg failed', { code, stderr: stderr.substring(0, 500) });
            reject(new Error(`FFmpeg failed with code ${code}`));
          }
        });
        
        ffmpeg.on('error', (error) => {
          logger.logError(error, { component: 'FFmpeg', event: 'spawn error' });
          if (fs.existsSync(tempListFile)) {
            fs.unlinkSync(tempListFile);
          }
          reject(error);
        });
        
      } catch (error) {
        logger.logError(error, { component: 'VideoProcessor', method: 'concatenateVideos' });
        if (fs.existsSync(tempListFile)) {
          fs.unlinkSync(tempListFile);
        }
        reject(error);
      }
    });
  }
}

// Process queue jobs
videoQueue.process(async (job) => {
  const { files, sessionId, groupId } = job.data;
  
  logger.info('Processing video job', { 
    jobId: job.id,
    sessionId, 
    groupId, 
    fileCount: files.length 
  });
  
  try {
    await job.progress(10);
    io.emit('job-progress', { sessionId, groupId, progress: 10, stage: 'preparing' });
    
    logger.debug('Verifying input files exist', { fileCount: files.length });
    for (const file of files) {
      if (!fs.existsSync(file.path)) {
        logger.error('Input file not found', { path: file.path, sessionId, groupId });
        throw new Error(`Input file not found: ${file.path}`);
      }
      logger.debug('Input file verified', { path: file.path, size: file.size });
    }
    
    await job.progress(20);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFilename = `GoPro_Merged_${groupId}_${timestamp}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, sessionId, outputFilename);
    
    logger.debug('Preparing output directory', { outputPath });
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      logger.debug('Created output directory', { outputDir });
    }
    
    await job.progress(30);
    
    const inputPaths = files.map(f => f.path);
    logger.debug('Input files prepared', { inputPaths });
    
    await VideoProcessor.concatenateVideos(
      inputPaths,
      outputPath,
      (progress) => {
        const progressPercent = Math.min(30 + 60, 90);
        job.progress(progressPercent);
        logger.debug('Job progress update', { sessionId, groupId, progressPercent, time: progress.time });
        io.emit('job-progress', {
          sessionId,
          groupId,
          progress: progressPercent,
          stage: 'processing',
          time: progress.time
        });
      }
    );
    
    await job.progress(100);
    
    const stats = fs.statSync(outputPath);
    const result = {
      success: true,
      outputPath,
      outputFilename,
      fileSize: stats.size,
      sessionId,
      groupId
    };
    
    logger.info('Job completed successfully', { 
      jobId: job.id,
      sessionId, 
      groupId, 
      outputFilename,
      fileSize: stats.size 
    });
    
    io.emit('job-complete', result);
    return result;
    
  } catch (error) {
    logger.logError(error, { 
      jobId: job.id,
      sessionId, 
      groupId,
      component: 'videoQueue.process' 
    });
    io.emit('job-error', { sessionId, groupId, error: error.message });
    throw error;
  }
});

// API Routes
app.post('/api/upload', upload.array('files'), async (req, res) => {
  const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
  
  logger.info('Upload request received', { 
    sessionId, 
    fileCount: req.files?.length || 0,
    ip: req.ip 
  });
  
  try {
    if (!req.files || req.files.length === 0) {
      logger.warn('No files uploaded', { sessionId });
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    logger.debug('Files uploaded', { 
      sessionId,
      files: req.files.map(f => ({ name: f.originalname, size: f.size }))
    });
    
    const groups = GoProFileDetector.groupFiles(req.files);
    
    if (groups.length === 0) {
      logger.warn('No valid GoPro file groups detected', { sessionId, fileCount: req.files.length });
      return res.status(400).json({ error: 'No valid GoPro file groups detected' });
    }
    
    const responseData = {
      success: true,
      sessionId,
      groups: groups.map((group, index) => ({
        id: `group_${index}`,
        sequence: group.sequence,
        encoding: group.encoding,
        chapters: group.chapters,
        totalSize: group.chapters.reduce((sum, ch) => sum + ch.size, 0),
        chapterCount: group.chapters.length
      }))
    };
    
    logger.info('Upload successful', { 
      sessionId, 
      groupCount: groups.length,
      totalFiles: req.files.length 
    });
    
    res.json(responseData);
    
  } catch (error) {
    logger.logError(error, { sessionId, endpoint: '/api/upload' });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/process', async (req, res) => {
  const { sessionId, groups } = req.body;
  
  logger.info('Process request received', { 
    sessionId, 
    groupCount: groups?.length || 0,
    ip: req.ip 
  });
  
  try {
    if (!sessionId || !groups || !Array.isArray(groups)) {
      logger.warn('Invalid process request data', { sessionId, hasGroups: !!groups });
      return res.status(400).json({ error: 'Invalid request data' });
    }
    
    const jobs = [];
    
    for (const group of groups) {
      logger.debug('Adding job to queue', { 
        sessionId, 
        groupId: group.id, 
        chapterCount: group.chapters?.length 
      });
      
      const job = await videoQueue.add('concatenate', {
        files: group.chapters,
        sessionId,
        groupId: group.id
      });
      
      jobs.push({
        id: job.id,
        groupId: group.id,
        status: 'queued'
      });
      
      logger.info('Job queued', { jobId: job.id, sessionId, groupId: group.id });
    }
    
    logger.info('All jobs queued successfully', { sessionId, jobCount: jobs.length });
    res.json({ success: true, jobs });
    
  } catch (error) {
    logger.logError(error, { sessionId, endpoint: '/api/process' });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/download/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  const filePath = path.join(OUTPUT_DIR, sessionId, filename);
  
  logger.info('Download request', { sessionId, filename, ip: req.ip });
  
  try {
    if (!fs.existsSync(filePath)) {
      logger.warn('Download file not found', { sessionId, filename, filePath });
      return res.status(404).json({ error: 'File not found' });
    }
    
    const stats = fs.statSync(filePath);
    logger.info('Starting file download', { 
      sessionId, 
      filename, 
      fileSize: stats.size 
    });
    
    res.download(filePath, filename);
    
  } catch (error) {
    logger.logError(error, { sessionId, filename, endpoint: '/api/download' });
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  const healthData = { 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  
  logger.debug('Health check', healthData);
  res.json(healthData);
});

// WebSocket
io.on('connection', (socket) => {
  logger.info('WebSocket client connected', { 
    socketId: socket.id, 
    ip: socket.handshake.address 
  });
  
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    logger.info('Client joined session', { socketId: socket.id, sessionId });
  });
  
  socket.on('disconnect', () => {
    logger.info('WebSocket client disconnected', { socketId: socket.id });
  });
  
  socket.on('error', (error) => {
    logger.logError(error, { socketId: socket.id, component: 'WebSocket' });
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  logger.info('Server started successfully', {
    port: PORT,
    uploadDir: UPLOAD_DIR,
    outputDir: OUTPUT_DIR,
    redisUrl: REDIS_URL,
    nodeVersion: process.version,
    platform: process.platform
  });
  logger.info(`GoPro Video Processor running on port ${PORT}`);
});

module.exports = app;
