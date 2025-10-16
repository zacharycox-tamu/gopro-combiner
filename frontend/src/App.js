import React, { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_BASE = window.location.origin;

const App = () => {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [socket, setSocket] = useState(null);
  const [files, setFiles] = useState([]);
  const [groups, setGroups] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [completedFiles, setCompletedFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  // Initialize WebSocket connection
  useEffect(() => {
    const socketConnection = io(window.location.origin);
    
    socketConnection.on('connect', () => {
      setConnectionStatus('connected');
      socketConnection.emit('join-session', sessionId);
    });
    
    socketConnection.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });
    
    socketConnection.on('job-progress', (data) => {
      if (data.sessionId === sessionId) {
        setJobs(prev => prev.map(job => 
          job.groupId === data.groupId 
            ? { ...job, progress: data.progress, stage: data.stage, time: data.time }
            : job
        ));
      }
    });
    
    socketConnection.on('job-complete', (data) => {
      if (data.sessionId === sessionId) {
        setJobs(prev => prev.map(job => 
          job.groupId === data.groupId 
            ? { ...job, status: 'completed', progress: 100 }
            : job
        ));
        fetchCompletedFiles();
      }
    });
    
    socketConnection.on('job-error', (data) => {
      if (data.sessionId === sessionId) {
        setJobs(prev => prev.map(job => 
          job.groupId === data.groupId 
            ? { ...job, status: 'failed', error: data.error }
            : job
        ));
      }
    });
    
    setSocket(socketConnection);
    
    return () => {
      socketConnection.disconnect();
    };
  }, [sessionId]);

  const fetchCompletedFiles = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/files/${sessionId}`);
      const data = await response.json();
      setCompletedFiles(data.files || []);
    } catch (error) {
      console.error('Error fetching completed files:', error);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchCompletedFiles();
  }, [fetchCompletedFiles]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    handleFiles(droppedFiles);
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    handleFiles(selectedFiles);
  };

  const handleFiles = async (fileList) => {
    setFiles(fileList);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      fileList.forEach(file => {
        formData.append('files', file);
      });

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: {
          'X-Session-Id': sessionId
        },
        body: formData
      });

      const data = await response.json();
      
      if (data.success) {
        setGroups(data.groups);
        setUploadProgress(100);
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleProcess = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId,
          groups
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setJobs(data.jobs.map(job => ({
          ...job,
          status: 'queued',
          progress: 0
        })));
      } else {
        throw new Error(data.error || 'Processing failed');
      }
    } catch (error) {
      console.error('Processing error:', error);
      alert(`Processing failed: ${error.message}`);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>
            <span className="logo">📹</span>
            GoPro Video Processor
          </h1>
          <div className="connection-status">
            <span className={`status-indicator ${connectionStatus}`}></span>
            {connectionStatus === 'connected' ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </header>

      <main className="main-content">
        {/* Upload Section */}
        <section className="upload-section">
          <div
            className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isUploading ? (
              <div className="upload-progress">
                <div className="progress-circle">
                  <span>{uploadProgress}%</span>
                </div>
                <p>Processing files...</p>
              </div>
            ) : (
              <>
                <div className="upload-icon">📁</div>
                <h3>Drop GoPro files here</h3>
                <p>or click to browse files</p>
                <input
                  type="file"
                  multiple
                  accept=".mp4,.MP4,.lrv,.LRV,.thm,.THM"
                  onChange={handleFileSelect}
                  className="file-input"
                />
              </>
            )}
          </div>
          
          {files.length > 0 && !isUploading && (
            <div className="uploaded-files">
              <h4>Uploaded Files ({files.length})</h4>
              <div className="file-grid">
                {files.map((file, index) => (
                  <div key={index} className="file-item">
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{formatFileSize(file.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* File Groups Section */}
        {groups.length > 0 && (
          <section className="groups-section">
            <div className="section-header">
              <h3>Detected GoPro File Groups</h3>
              <button 
                className="process-btn"
                onClick={handleProcess}
                disabled={jobs.length > 0}
              >
                {jobs.length > 0 ? 'Processing...' : 'Start Processing'}
              </button>
            </div>
            
            <div className="groups-grid">
              {groups.map((group) => (
                <div key={group.id} className="group-card">
                  <div className="group-header">
                    <h4>Sequence {group.sequence}</h4>
                    <span className="encoding-badge">{group.encoding}</span>
                  </div>
                  <div className="group-details">
                    <p>{group.chapterCount} chapters • {formatFileSize(group.totalSize)}</p>
                  </div>
                  <div className="chapters">
                    {group.chapters.map((chapter, chapterIndex) => (
                      <div key={chapterIndex} className="chapter-item">
                        <span className="chapter-num">Ch. {chapter.chapter}</span>
                        <span className="chapter-name">{chapter.originalname}</span>
                        <span className="chapter-size">{formatFileSize(chapter.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Processing Queue Section */}
        {jobs.length > 0 && (
          <section className="queue-section">
            <h3>Processing Queue</h3>
            <div className="jobs-list">
              {jobs.map((job) => (
                <div key={job.id} className={`job-card ${job.status}`}>
                  <div className="job-header">
                    <h4>Group {job.groupId}</h4>
                    <span className={`status-badge ${job.status}`}>
                      {job.status.toUpperCase()}
                    </span>
                  </div>
                  
                  {job.status !== 'completed' && job.status !== 'failed' && (
                    <div className="progress-bar">
                      <div 
                        className="progress-fill"
                        style={{ width: `${job.progress || 0}%` }}
                      ></div>
                      <span className="progress-text">
                        {job.progress || 0}% 
                        {job.stage && ` - ${job.stage}`}
                        {job.time && ` (${job.time})`}
                      </span>
                    </div>
                  )}
                  
                  {job.error && (
                    <div className="error-message">
                      Error: {job.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Downloads Section */}
        {completedFiles.length > 0 && (
          <section className="downloads-section">
            <h3>Completed Videos</h3>
            <div className="downloads-grid">
              {completedFiles.map((file, index) => (
                <div key={index} className="download-card">
                  <div className="download-info">
                    <h4>{file.filename}</h4>
                    <p>
                      {formatFileSize(file.size)} • 
                      Created {new Date(file.created).toLocaleString()}
                    </p>
                  </div>
                  <a
                    href={`${API_BASE}${file.downloadUrl}`}
                    download={file.filename}
                    className="download-btn"
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>GoPro Video Processor • Automatically combines chaptered video files</p>
      </footer>
    </div>
  );
};

export default App;
