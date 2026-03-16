import os
import json
import base64
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ENCRYPTION_KEY = os.environ.get("AES_SECRET", "d3377d4ddc5d3f33c6a9100d28993874").encode("utf-8")
API_KEY = os.environ.get("GEMINI_API_KEY")

if not API_KEY:
    raise ValueError("CRITICAL ERROR: GEMINI_API_KEY is not set. Please export GEMINI_API_KEY or add it to a .env file before running this server.")

# Using the new genai client as per Python SDK documentation
client = genai.Client(api_key=API_KEY)

def encrypt_data(data: str) -> dict:
    cipher = AES.new(ENCRYPTION_KEY, AES.MODE_CBC)
    ct_bytes = cipher.encrypt(pad(data.encode("utf-8"), AES.block_size))
    iv = base64.b64encode(cipher.iv).decode("utf-8")
    ct = base64.b64encode(ct_bytes).decode("utf-8")
    return {"iv": iv, "payload": ct}

class ReconRequest(BaseModel):
    address: str
    withResponders: bool = False

class AnalyzeRequest(BaseModel):
    transcript: str

class AutonomousRequest(BaseModel):
    summary: str
    emergencyType: str
    activeThreats: str
    infrastructureStatus: str
    personsInvolved: str
    actionsTaken: list[str]

@app.get("/api/config")
def get_config():
    # Provide the API key to the frontend so it can initialize the LiveClient Socket connection securely
    data = json.dumps({"apiKey": API_KEY})
    return encrypt_data(data)

@app.post("/api/recon")
def generate_recon(req: ReconRequest):
    base_prompt = f"""Generate a photorealistic aerial drone photograph looking straight down at this location: "{req.address}".

Requirements:
- FULL COLOR image, NOT black and white
- Bird's eye / top-down drone perspective from about 200 feet altitude
- Show the street, buildings, rooftops, parked cars, trees
- Daytime with natural lighting and shadows
"""
    if req.withResponders:
        base_prompt += """- INCLUDE emergency vehicles at the scene: fire trucks with flashing lights, police cars with sirens, ambulances  
- Show firefighters near the building, hoses deployed
- Show police cars blocking the street forming a perimeter
- The scene should look like an ACTIVE emergency response in progress
"""
    else:
        base_prompt += """- DO NOT include any emergency vehicles, police, firefighters, or officials
- DO NOT include any people in uniform
- The scene should look like a normal neighborhood BEFORE emergency response arrives
"""
    base_prompt += f"""- Realistic urban/suburban environment with detail
- Include a visible street sign or text overlay showing: "{req.address}"
"""
    try:
        response = client.models.generate_images(
            model='gemini-3-pro-image-preview',
            prompt=base_prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                output_mime_type="image/jpeg",
                aspect_ratio="16:9",
            )
        )
        if hasattr(response, 'generated_images') and len(response.generated_images) > 0:
            image_bytes = response.generated_images[0].image.image_bytes
            b64_str = base64.b64encode(image_bytes).decode('utf-8')
            return encrypt_data(json.dumps({"image": b64_str}))
        return encrypt_data(json.dumps({"error": "No image generated"}))
    except Exception as e:
        return encrypt_data(json.dumps({"error": str(e)}))

@app.post("/api/analyze/incident")
def analyze_incident(req: AnalyzeRequest):
    prompt = f"""Analyze this 911 transcript and extract information.
           
VOICE TONE ANALYSIS (CRITICAL):
- Carefully analyze the caller's emotional state from their language
- Look for: urgency words, exclamations, panic indicators, calmness
- "Help! Fire! Screaming!" = Panic
- "There's an emergency, people trapped" = Distressed  
- "I need to report an incident" = Urgent
- "The situation is under control now" = Controlled
- "Everything is fine, thank you" = Calm

TACTICAL LOGISTICS:
- Focus on INFRASTRUCTURE and CONTAINMENT (Fire Evac, Grid Lockdown, Traffic Control)
- infrastructureStatus: report on Roads, Power Grid, Structure Integrity
- DO NOT PROVIDE MEDICAL ADVICE

TRANSCRIPT: {req.transcript}"""

    # We will use text output and JSON parsing via schema on the frontend
    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "situation": types.Schema(type=types.Type.STRING),
            "personsInvolved": types.Schema(type=types.Type.STRING),
            "weapons": types.Schema(type=types.Type.STRING),
            "activeThreats": types.Schema(type=types.Type.STRING),
            "infrastructureStatus": types.Schema(type=types.Type.STRING, description="Status of nearby infra (Power, Traffic, Structures)"),
            "tone": types.Schema(
                type=types.Type.STRING, 
                enum=["Panic", "Distressed", "Urgent", "Controlled", "Calm"], 
                description="Caller's emotional state based on language analysis"
            ),
            "emergencyType": types.Schema(type=types.Type.STRING),
            "suggestedActions": types.Schema(
                type=types.Type.ARRAY, 
                items=types.Schema(type=types.Type.STRING), 
                description="Smart City Commands (e.g. 'Lockdown Sector A', 'Deploy Drones')"
            ),
            "suggestedQuestions": types.Schema(
                type=types.Type.ARRAY, 
                items=types.Schema(type=types.Type.STRING)
            ),
            "activeProtocol": types.Schema(
                  type=types.Type.OBJECT,
                  properties={
                    "title": types.Schema(type=types.Type.STRING, description="Name of the protocol (e.g. Structural Evac)"),
                    "steps": types.Schema(
                      type=types.Type.ARRAY,
                      items=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                          "id": types.Schema(type=types.Type.STRING),
                          "text": types.Schema(type=types.Type.STRING),
                          "status": types.Schema(type=types.Type.STRING, enum=["pending", "completed"])
                        }
                      )
                    )
                  }
            )
        }
    )

    try:
        response = client.models.generate_content(
            model='gemini-3-flash-preview',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
            )
        )
        return encrypt_data(response.text)
    except Exception as e:
        return encrypt_data(json.dumps({"error": str(e)}))

@app.post("/api/analyze/autonomous")
def evaluate_autonomous_actions(req: AutonomousRequest):
    actions_list = "\\n".join([f"- {a}" for a in req.actionsTaken]) if req.actionsTaken else "- None yet"
    prompt = f"""You are an AUTONOMOUS emergency dispatcher AI. Based on the current incident, decide if ANY proactive actions should be taken NOW.

CURRENT INCIDENT STATE:
- Situation: {req.summary}
- Emergency Type: {req.emergencyType or 'Unknown'}
- Threat Level: {req.activeThreats}
- Infrastructure: {req.infrastructureStatus}
- Persons: {req.personsInvolved}

ACTIONS ALREADY TAKEN (do NOT repeat):
{actions_list}

Decide if you should proactively take ONE of these actions NOW:
1. dispatch_backup - Deploy additional units if situation is escalating
2. expand_perimeter - Widen the lockdown area for safety
3. request_air_support - Call for helicopter if needed
4. notify_hospitals - Alert nearby hospitals of incoming casualties
5. none - No action needed right now

Respond with JSON. Only suggest an action if it's CLEARLY needed and NOT already taken."""

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "shouldAct": types.Schema(type=types.Type.BOOLEAN, description="Whether to take action"),
            "action": types.Schema(type=types.Type.STRING, description="Action to take"),
            "reason": types.Schema(type=types.Type.STRING, description="Why this action is needed"),
            "details": types.Schema(type=types.Type.STRING, description="Specific details for the action"),
        }
    )

    try:
        response = client.models.generate_content(
            model='gemini-3-flash-preview',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
            )
        )
        return encrypt_data(response.text)
    except Exception as e:
        return encrypt_data(json.dumps({"error": str(e)}))
