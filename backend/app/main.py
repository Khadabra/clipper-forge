from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import health, system
from app.api.routes import projects, jobs, transcripts, clips
from app.core.config import settings
from app.db.session import init_db
from app.services.job_queue import job_queue


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the database and background queue worker on startup."""
    init_db()
    await job_queue.start()
    yield
    await job_queue.stop()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="ClipForge Studio — Local-first AI clipping and creator workstation API",
    lifespan=lifespan,
)

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
app.include_router(health.router, prefix=settings.API_V1_STR, tags=["Health"])
app.include_router(system.router, prefix=settings.API_V1_STR, tags=["System"])
app.include_router(projects.router, prefix=f"{settings.API_V1_STR}", tags=["Projects"])
app.include_router(jobs.router, prefix=f"{settings.API_V1_STR}", tags=["Jobs"])
app.include_router(transcripts.router, prefix=f"{settings.API_V1_STR}", tags=["Transcripts"])
app.include_router(clips.router, prefix=f"{settings.API_V1_STR}", tags=["Clips"])


@app.get("/")
def root():
    return {
        "message": f"Welcome to {settings.PROJECT_NAME} API",
        "docs_url": "/docs",
        "health_url": f"{settings.API_V1_STR}/health",
        "system_check_url": f"{settings.API_V1_STR}/system/check",
        "projects_url": f"{settings.API_V1_STR}/projects",
    }


# Serve project video files for the frontend preview player
# Must be mounted AFTER all API routes so API routes take priority
settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/storage",
    StaticFiles(directory=str(settings.STORAGE_DIR)),
    name="storage",
)
