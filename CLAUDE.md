# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A podcast script generation tool that uploads Excel files to Dify AI workflow and generates markdown podcast scripts. Built with Node.js backend and vanilla JavaScript frontend.

## Architecture

### Backend (Node.js + Express)
- **server.js**: Main Express server with SSE (Server-Sent Events) for real-time progress updates
- **difyClient.js**: Dify API client handling file uploads and streaming workflow execution
- **config.js**: Environment configuration and dynamic output directory management (organized by date: `outputs/YYYY/MM/DD/`)
- **logger.js**: Logging system that writes to both console and date-organized log files

### Frontend (Vanilla JS)
- **frontend/app.js**: Handles drag-and-drop file upload, SSE event processing, and UI updates
- **frontend/index.html** & **style.css**: UI components with progress tracking and log display

### Data Flow
1. User uploads `.xlsx` file via drag-and-drop or file picker
2. Backend uploads file to Dify using `DifyClient.uploadFile()` → receives `upload_file_id`
3. Backend calls `DifyClient.runWorkflowStreaming()` with file reference
4. Dify workflow streams events (`workflow_started`, `node_started`, `node_finished`, `text_chunk`, `workflow_finished`)
5. Backend relays events to frontend via SSE
6. Results saved to `outputs/YYYY/MM/DD/result_HHMMSS.md`

## Common Commands

### Development
```bash
# Install dependencies
cd backend
npm install

# Start server (production)
npm start
# or: node backend/server.js

# Start server (development with auto-restart)
npm run dev

# Quick start (Windows)
start.bat
```

### Configuration
Environment variables in `.env`:
- `DIFY_API_KEY`: Dify API key (required)
- `DIFY_BASE_URL`: Dify API base URL (default: `https://api.dify.ai/v1`)

Server runs on `http://127.0.0.1:8000`

## API Endpoints

- `POST /api/execute` - Upload file and execute workflow (returns SSE stream)
- `GET /api/download/:filename` - Download generated markdown file
- `GET /api/logs?page=1&limit=20&status=succeeded` - Query workflow execution logs
- `GET /api/health` - Health check with config info

## File Organization

- Outputs: `outputs/YYYY/MM/DD/result_HHMMSS.md`
- Logs: `outputs/YYYY/MM/DD/logs/execution_HHMMSS.log`

Directories are automatically created based on current date.

## Key Implementation Details

### SSE Event Handling
The backend acts as a proxy between Dify's streaming API and the frontend. It parses Dify's SSE events and forwards custom events (`progress`, `success`, `error`) to the frontend.

### Dify Workflow Input Format
Files are passed to Dify workflows using this structure:
```javascript
{
  inputs: {
    [fileVariableName]: [{
      type: 'document',
      transfer_method: 'local_file',
      upload_file_id: uploadFileId
    }]
  },
  response_mode: 'streaming',
  user: userId
}
```

### Result Assembly
The system collects `text_chunk` events during workflow execution and combines them into the final markdown file. If no chunks are received, it falls back to checking `workflow_finished.data.outputs` for keys: `text`, `result`, `output`, or `content`.


# The Eight Honors and Eight Shames of Claude Code
Shame in guessing APIs, Honor in careful research.
Shame in vague execution, Honor in seeking confirmation.
Shame in assuming business logic, Honor in human verification.
Shame in creating interfaces, Honor in reusing existing ones.
Shame in skipping validation, Honor in proactive testing.
Shame in breaking architecture, Honor in following specifications.
Shame in pretending to understand, Honor in honest ignorance.
Shame in blind modification, Honor in careful refactoring.
