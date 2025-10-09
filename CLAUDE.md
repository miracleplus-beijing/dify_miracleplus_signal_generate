# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A podcast script generation tool that uploads Excel files to Dify AI workflow and generates markdown podcast scripts. Built with Node.js backend and vanilla JavaScript frontend. Includes Python-based text-to-speech conversion using SiliconFlow API.

## Architecture

### Backend (Node.js + Express)
- **server.js**: Main Express server with SSE (Server-Sent Events) for real-time progress updates
- **difyClient.js**: Dify API client handling file uploads and streaming workflow execution
- **config.js**: Environment configuration and dynamic output directory management (organized by date: `outputs/YYYY/MM/DD/`)
- **logger.js**: Logging system that writes to both console and date-organized log files
- **supabaseClient.js**: Supabase API client for Excel data upload to podcast database
- **excelParser.js**: Excel file parser with data validation functionality

### Frontend (Vanilla JS)
- **frontend/app.js**: Handles drag-and-drop file upload, SSE event processing, UI updates, and Supabase upload result display
- **frontend/index.html** & **style.css**: UI components with progress tracking, log display, channel selection dropdown, and upload result summary

### Python TTS Module
- **podcast_generator/produce_podcast.py**: CLI text-to-speech tool (SiliconFlow API) with `--script`, `--output-dir`, `--voice-map`, `--check-only`, `--verbose`, and structured logging
- **podcast_generator/female_base64.txt** & **male_base64.txt**: Voice reference samples

## Common Commands

### Backend Development
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

### Python TTS Module
```bash
cd podcast_generator
python produce_podcast.py --script ../outputs/YYYY/MM/DD/sample.md --output-dir ../outputs/YYYY/MM/DD --check-only
# remove --check-only to reach SiliconFlow and emit audio files
```

### Configuration
Environment variables in `.env`:
- `DIFY_API_KEY`: Dify API key (required)
- `DIFY_BASE_URL`: Dify API base URL (default: `https://api.dify.ai/v1`)
- `SILICONFLOW_API_KEY`: SiliconFlow API key for TTS (required for podcast_generator)
- `SILICONFLOW_BASE_URL`: SiliconFlow API base URL

Server runs on `http://127.0.0.1:8000`

## API Endpoints

- `POST /api/execute` - Upload file and execute workflow (returns SSE stream)
  - Request body: `FormData` with `file`, `workflow`, `channelId`
  - Channel options: `355ed9b9-58d6-4716-a542-cadc13ae8ef4` (论文前沿日报), `216c4396-cf27-425b-be09-e8565cf98dd2` (大厂动态一览), `3f1c022b-222a-420a-9126-f96c63144ddc` (经典论文解读)
- `GET /api/download/:filename` - Download generated markdown file
- `GET /api/logs?page=1&limit=20&status=succeeded` - Query workflow execution logs
- `GET /api/health` - Health check with config info

## File Organization

- **Script Output**: `outputs/YYYY/MM/DD/论文播客稿-YYYY-MM-DD-HH-MM-SS.json` (JSON array format)
- **Audio Output**: `outputs/YYYY/MM/DD/{arxiv_id}.mp3` (one file per podcast)
- **Mapping Files**:
  - `arxiv_mapping.json`: Maps paper indices to arXiv IDs
  - `podcast_titles.json`: Maps arXiv IDs to podcast titles
  - `audio_generation_result.json`: Statistics of audio generation
- **Logs**: `outputs/YYYY/MM/DD/logs/execution_HHMMSS.log`

Directories are automatically created based on current date.

## Dependencies

### Node.js Dependencies (backend/package.json)
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.38.4",
    "axios": "^1.6.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "form-data": "^4.0.0",
    "multer": "^1.4.5-lts.1",
    "music-metadata": "^11.9.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

### Python Dependencies (requirements.txt)
```txt
openai>=2.0.0
requests>=2.32.0
python-dotenv>=1.0.0
```

**System Requirements**:
- Node.js >= 18.0.0 (tested with v22.17.0)
- Python >= 3.8 (tested with Python 3.13.5)
- npm >= 9.0.0

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

### Result Assembly and Audio Generation
The system uses a two-stage process for content generation:

#### Stage 1: Script Generation
- Dify returns Python list format: `[{'title': '...', 'script': '[S1]...'}]`
- Backend converts single quotes to double quotes for standard JSON
- Saves as `.json` file (e.g., `论文播客稿-2025-10-09-07-42-23.json`)
- **Key Change (2025-10-09)**: Previously extracted only `script` field and merged into plain text; now preserves full JSON array structure

#### Stage 2: Audio Generation
- Backend calls Python TTS module with JSON file path
- Python parses JSON array, extracting each `{title, script}` object
- Generates separate MP3 file for each podcast using `arxiv_id.mp3` naming
- Uploads all audio files to Supabase Storage
- Updates database `audio_url` field for each arXiv ID

**Example Flow**:
```
Input: Excel with 2 papers (arxiv_id: A, B)
  ↓
Dify Output: [{"title": "T1", "script": "S1"}, {"title": "T2", "script": "S2"}]
  ↓
Save: 论文播客稿-XXX.json (standard JSON with double quotes)
  ↓
Python Parse: 2 segments detected
  ↓
Generate: A.mp3, B.mp3
  ↓
Upload: Supabase Storage → podcast-audios/daily-papers/A.mp3, B.mp3
  ↓
Database: Update audio_url for arxiv_id A and B
```

### Supabase Database Integration
The system includes comprehensive Supabase database integration for storing podcast metadata:

#### Excel Data Mapping
| Excel Field | Supabase Field | Notes |
|-------------|----------------|-------|
| ID | arxiv_id | arXiv identifier |
| Title | title, paper_title | Paper title (duplicated for compatibility) |
| Authors | authors | JSON array with author names and match status |
| Abstract | description | Paper abstract |
| Abstract_URL | paper_url | Primary paper link |
| Project_URL | project_url | Project/repository link (NEW) |
| Published_Date | publish_date | Publication date |
| Primary_Category | primary_category | Primary arXiv category (NEW) |
| All_Categories | all_categories | All arXiv categories (NEW) |
| research_entities | institution | Research institutions |

#### Channel Selection
Users can select target podcast channel via dropdown in settings:
- **论文前沿日报** (ID: `355ed9b9-58d6-4716-a542-cadc13ae8ef4`) - Default channel
- **大厂动态一览** (ID: `216c4396-cf27-425b-be09-e8565cf98dd2`)
- **经典论文解读** (ID: `3f1c022b-222a-420a-9126-f96c63144ddc`)

#### Duplicate Data Handling
The system checks for existing arXiv IDs to prevent duplicate entries:
- If data exists: Skip upload and log informative message
- If all data skipped: Show "所有数据均已存在于数据库中，无需重复上传"
- Frontend displays appropriate status based on upload results

### Python TTS Module Configuration
The podcast_generator uses environment variables for API configuration and relative paths:
- Loads configuration from `.env` file using custom loader (produce_podcast.py:19-40)
- Uses relative paths for voice samples in `podcast_generator/` directory
- Outputs to project-standard `outputs/YYYY/MM/DD/` directory structure
- **Supports JSON array parsing** (produce_podcast.py:149-208):
  - Detects JSON format vs Markdown format
  - For JSON arrays: parses each `{title, script, arxiv_id}` object
  - For Markdown: treats entire file as single script
  - Matches arXiv IDs from `arxiv_mapping.json` for file naming

### Audio File Naming and Storage
- **Local Files**: `{arxiv_id}.mp3` (e.g., `2509.22646v1.mp3`)
- **Supabase Storage**: `{storagePath}/{arxiv_id}.mp3` (e.g., `daily-papers/2509.22646v1.mp3`)
- **Public URL**: Stored in database `audio_url` field
- **Batch Processing**: All audio files uploaded sequentially with progress tracking (server.js:26-114)

### Frontend Upload Result Display
The frontend provides intelligent feedback based on Supabase upload results:

#### Result Display Logic
- **All data skipped (duplicate)**: Shows "跳过 X 条记录（数据已存在）" in gray
- **All successful**: Shows "成功上传 X 条记录" in green
- **Has failures**: Shows "成功 X 条, 失败 Y 条" in red
- **Logs detailed status**: Color-coded messages in the log display

## Development Notes

### Error Handling
- Comprehensive error logging with stack traces
- Graceful degradation when API services are unavailable
- User-friendly error messages in frontend

### Performance Considerations
- Streaming responses for large files
- Efficient Excel parsing with memory management
- Concurrent processing where applicable

### Security
- API keys stored in environment variables only
- No sensitive data in code or version control
- Input validation for all file uploads

# The Eight Honors and Eight Shames of Claude Code
Shame in guessing APIs, Honor in careful research.
Shame in vague execution, Honor in seeking confirmation.
Shame in assuming business logic, Honor in human verification.
Shame in creating interfaces, Honor in reusing existing ones.
Shame in skipping validation, Honor in proactive testing.
Shame in breaking architecture, Honor in following specifications.
Shame in pretending to understand, Honor in honest ignorance.
Shame in blind modification, Honor in careful refactoring.