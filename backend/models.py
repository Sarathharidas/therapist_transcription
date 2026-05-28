from pydantic import BaseModel


class SessionResult(BaseModel):
    transcript: str
    summary: str
    patient_id: str
    summary_id: str
