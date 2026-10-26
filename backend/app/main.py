from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import health, system
from app.core.config import settings

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="ClipForge Studio — Local-first AI clipping and creator workstation API",
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


@app.get("/")
def root():
    return {
        "message": f"Welcome to {settings.PROJECT_NAME} API",
        "docs_url": "/docs",
        "health_url": f"{settings.API_V1_STR}/health",
        "system_check_url": f"{settings.API_V1_STR}/system/check",
    }
