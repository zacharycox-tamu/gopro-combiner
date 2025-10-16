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

// Ensure directories exist
[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Initialize Bull queue
const videoQueue = new Bull('video processing', REDIS_URL);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
    const sessionDir = path.join(UPLOAD_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.mp4', '.MP4', '.lrv', '.LRV', '.thm', '.THM'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
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
      return {
        encoding: match[1].toUpperCase(),
        chapter: parseInt(match[2], 10),
        sequence: parseInt(match[3], 10),
        extension: match[4].toUpperCase(),
        isGoPro: true
      };
    }
    return { isGoPro: false };
  }
  
  static groupFiles(files) {
    const groups = new Map();
    
    files.forEach(file => {
      const parsed = this.parseGoProFilename(file.originalname);
      
      if (parsed.isGoPro && parsed.extension === 'MP4') {
        const key = `${parsed.encoding}_${parsed.sequence}`;
        
        if (!groups.has(key)) {
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
      }
    });
    
    groups.forEach(group => {
      group.chapters.sort((a, b) => a.chapter - b.chapter);
    });
    
    return Array.from(groups.values());
  }
}

// Video processing with FFmpeg
class VideoProcessor {
  static async concatenateVideos(inputFiles, outputPath, onProgress) {
    return new Promise((resolve, reject) => {
      const tempListFile = path.join(path.dirname(outputPath), `filelist_${Date.now()}.txt`);
      
      try {
        const fileListContent = inputFiles
          .map(file => `file '${file.replace(/'/g, "'\\''")}'`)
          .join('\n');
        
        fs.writeFileSync(tempListFile, fileListContent);
        
        const ffmpegArgs = [
          '-f', 'concat',
          '-safe', '0',
          '-i', tempListFile,
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          outputPath
        ];
        
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        
        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
          
          const timeMatch = stderr.match(/time=([\d:.]+)/);
          if (timeMatch && onProgress) {
            onProgress({ time: timeMatch[1], stage: 'concatenating' });
          }
        });
        
        ffmpeg.on('close', (code) => {
          if (fs.existsSync(tempListFile)) {
            fs.unlinkSync(tempListFile);
          }
          
          if (code === 0) {
            resolve({ success: true, outputPath });
          } else {
            reject(new Error(`FFmpeg failed with code ${code}`));
          }
        });
        
        ffmpeg.on('error', (error) => {
          if (fs.existsSync(tempListFile)) {
            fs.unlinkSync(tempListFile);
          }
          reject(error);
        });
        
      } catch (error) {
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
  
  try {
    await job.progress(10);
    io.emit('job-progress', { sessionId, groupId, progress: 10, stage: 'preparing' });
    
    for (const file of files) {
      if (!fs.existsSync(file.path)) {
        throw new Error(`Input file not found: ${file.path}`);
      }
    }
    
    await job.progress(20);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFilename = `GoPro_Merged_${groupId}_${timestamp}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, sessionId, outputFilename);
    
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    await job.progress(30);
    
    const inputPaths = files.map(f => f.path);
    
    await VideoProcessor.concatenateVideos(
      inputPaths,
      outputPath,
      (progress) => {
        const progressPercent = Math.min(30 + 60, 90);
        job.progress(progressPercent);
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
    
    io.emit('job-complete', result);
    return result;
    
  } catch (error) {
    io.emit('job-error', { sessionId, groupId, error: error.message });
    throw error;
  }
});

// API Routes
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'] || crypto.randomUUID();
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    const groups = GoProFileDetector.groupFiles(req.files);
    
    if (groups.length === 0) {
      return res.status(400).json({ error: 'No valid GoPro file groups detected' });
    }
    
    res.json({
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
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/process', async (req, res) => {
  try {
    const { sessionId, groups } = req.body;
    
    if (!sessionId || !groups || !Array.isArray(groups)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }
    
    const jobs = [];
    
    for (const group of groups) {
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
    }
    
    res.json({ success: true, jobs });
    
  } catch (error) {
    console.error('Process error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/download/:sessionId/:filename', (req, res) => {
  try {
    const { sessionId, filename } = req.params;
    const filePath = path.join(OUTPUT_DIR, sessionId, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(filePath, filename);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// WebSocket
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`Client ${socket.id} joined session: ${sessionId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`GoPro Video Processor running on port ${PORT}`);
  console.log(`Upload directory: ${UPLOAD_DIR}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Redis URL: ${REDIS_URL}`);
});

module.exports = app;
