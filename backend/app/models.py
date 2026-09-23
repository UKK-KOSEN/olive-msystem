"""Pydantic request/response models."""
from __future__ import annotations

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str | None = None
    farm_name: str | None = None
    farm_area: str | None = None
    farm_trees: int | None = None
    farm_variety: str | None = None
    farm_location: str | None = None
    farm_contact: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class FarmerUpdateRequest(BaseModel):
    display_name: str | None = None
    farm_name: str | None = None
    farm_area: str | None = None
    farm_trees: int | None = None
    farm_variety: str | None = None
    farm_location: str | None = None
    farm_contact: str | None = None
    is_active: bool | None = None


class PasswordResetRequest(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=128)


class TreeCreate(BaseModel):
    tree_id: str = Field(..., min_length=1, max_length=64)
    name: str | None = None
    variety: str | None = None
    row_num: int = Field(1, ge=1, le=200)
    col_num: int = Field(1, ge=1, le=64)
    note: str | None = None


class TreeUpdate(BaseModel):
    name: str | None = None
    variety: str | None = None
    row_num: int | None = Field(None, ge=1, le=200)
    col_num: int | None = Field(None, ge=1, le=64)
    note: str | None = None


class SoilMoistureInput(BaseModel):
    """Optional soil moisture readings supplied by the operator."""
    sensor1_moisture_percent: float | None = None
    sensor2_moisture_percent: float | None = None
    temperature: float | None = None
    humidity: float | None = None
    measured_at: str | None = None


class AnalyseTimesRequest(BaseModel):
    """Times (in seconds) at which to analyse an uploaded video."""
    times: list[float] = Field(..., description="Seconds from the start of the video")
    tree_id: str | None = None
    soil_moisture: SoilMoistureInput | None = None
    drone_mode: bool = Field(default=False, description="Drone/aerial (low-res) detection mode")
    upscale: bool | None = Field(default=None, description="Upscale low-res frames (True force, False disable, None auto from drone_mode)")


class AnalyseTimesTextRequest(BaseModel):
    """Times as human strings: 'HH:MM:SS', 'MM:SS', or seconds."""
    times: list[str] = Field(..., description="Time specs, e.g. ['00:00:15','00:00:30']")
    tree_id: str | None = None
    soil_moisture: SoilMoistureInput | None = None
    drone_mode: bool = Field(default=False, description="Drone/aerial (low-res) detection mode")
    upscale: bool | None = Field(default=None, description="Upscale low-res frames (True force, False disable, None auto from drone_mode)")


class AnalyseImageRequest(BaseModel):
    """Analyse a single uploaded image."""
    tree_id: str | None = None
    soil_moisture: SoilMoistureInput | None = None
    drone_mode: bool = Field(default=False, description="Drone/aerial (low-res) detection mode")
    upscale: bool | None = Field(default=None, description="Upscale low-res frames (True force, False disable, None auto from drone_mode)")


class HealthState(BaseModel):
    label: str
    score: float
    color: str
    message: str
