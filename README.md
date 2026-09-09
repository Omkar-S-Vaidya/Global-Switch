# Global Switch

Global Switch is a job-search and application tracking platform I built to solve a problem I was facing myself.

While looking for remote and international opportunities, I found myself switching between multiple job boards, company career pages, spreadsheets, and notes just to keep track of where I had applied. I wanted one place where I could discover opportunities, manage companies, track applications, and keep my profile and job-search data together.

## What it does

Global Switch brings the main parts of my job search into one application:

- Browse and manage job opportunities
- Track applications through a pipeline
- Maintain a list of target companies
- Manage profile and job-search preferences
- Store and work with resume-related information
- Authenticate users and keep their data separate
- Pull jobs from multiple external sources when configured

## Tech Stack

### Frontend
- Next.js
- React
- JavaScript
- CSS

### Backend
- Next.js API Routes
- Node.js

### Database
- PostgreSQL
- Neon Serverless

### Authentication
- JWT using `jose`
- Password hashing using `bcryptjs`

### Other tools
- TipTap for rich-text editing
- pdf-lib / pdfjs-dist / html2pdf.js for PDF-related functionality
- Mammoth for document parsing

## Architecture

The project uses the Next.js App Router, so the frontend and backend live in the same application.

The UI is organised around features such as:

- `/companies`
- `/pipeline`
- `/profile`
- `/login`

Backend functionality is exposed through API routes under:

`/app/api`

The main API areas are:

- applications
- auth
- companies
- jobs
- profile
- settings
- tracker

Shared business and utility logic lives under:

`/app/lib`

I kept this logic separate from the UI and route handlers so that things such as authentication, job feeds, resume parsing, date handling, and tracking logic did not end up duplicated across components.

## Job Sources

One thing I wanted to avoid was tying the application to a single job board.

The application can work with different job sources depending on which API credentials are configured.

Currently the environment supports integrations such as:

- Adzuna
- USAJobs
- Reed
- Jooble

This also means the application can still work when some optional providers are not configured.

## Authentication

Authentication is handled inside the application rather than depending on a third-party auth platform.

Passwords are hashed before being stored, and authenticated sessions are handled using signed tokens.

I chose this approach because I wanted to understand and control the authentication flow myself instead of hiding it behind a library or external service.

For a larger production system, I would also look at areas such as refresh-token rotation, stricter session management, rate limiting, and more extensive security monitoring.

## Database

The application uses PostgreSQL with Neon.

I chose a relational database because most of the important data has clear relationships:

- users
- companies
- jobs
- applications
- application status
- profile information

For example, an application belongs to a user and is related to a job/company. Keeping those relationships explicit makes the data easier to query and maintain than storing everything as loosely structured documents.

## A decision I made

One decision I made was to keep the project as a single Next.js application with both UI and API routes instead of creating a separate frontend and backend service.

For this project, that reduced setup and deployment complexity and allowed me to move faster.

The trade-off is that if the product grew significantly, I might eventually separate some backend responsibilities into dedicated services, especially job ingestion, background processing, or other workloads that need to scale independently.

I don't think one approach is always better. For the current size of the project, keeping it together was the more practical choice.

## Resume handling

The project also includes resume-related functionality.

There is shared logic for parsing resume information, generating HTML/PDF content, and working with uploaded document formats.

I wanted this functionality to stay separate from page components because document processing can become complicated quickly, and mixing it directly into UI code would make the application harder to maintain.

## Running locally

Clone the repository:

```bash
git clone https://github.com/Omkar-S-Vaidya/Global-Switch.git
cd Global-Switch
