import asyncio
import base64
import json
import os
import sys
import urllib.request
import websockets

MODEL = "gemini-3.1-flash-live-preview"
API_KEY = os.environ.get("GEMINI_API_KEY", "")

AUDIO_URL = "https://raw.githubusercontent.com/voxserv/audio_quality_testing_samples/master/testaudio/16000/test01_20s.wav"
AUDIO_FILE = "test01_20s.wav"

async def download_audio():
    if not os.path.exists(AUDIO_FILE):
        print(f"Downloading test audio from {AUDIO_URL}...")
        urllib.request.urlretrieve(AUDIO_URL, AUDIO_FILE)
        print("Download complete.")
    else:
        print("Test audio file already exists.")

async def send_audio(ws):
    print("Starting audio stream...")
    with open(AUDIO_FILE, "rb") as f:
        # Skip WAV header (first 44 bytes) to send raw PCM
        f.seek(44)
        
        # 16kHz, 16-bit mono PCM = 32,000 bytes per second
        # Send 100ms chunks = 3,200 bytes per chunk
        chunk_size = 3200
        
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
                
            base64_audio = base64.b64encode(chunk).decode("utf-8")
            payload = {
                "realtimeInput": {
                    "audio": {
                        "data": base64_audio,
                        "mimeType": "audio/pcm;rate=16000"
                    }
                }
            }
            await ws.send(json.dumps(payload))
            await asyncio.sleep(0.1)
            
    print("Audio stream finished.")

async def receive_responses(ws):
    try:
        async for message in ws:
            data = json.loads(message)
            
            # Handle setup complete
            if "setupComplete" in data:
                print("Setup completed successfully. Ready for audio.")
                # Start sending audio task
                asyncio.create_task(send_audio(ws))
                
            # Handle server content (transcripts)
            if "serverContent" in data:
                content = data["serverContent"]
                if "inputTranscription" in content:
                    tx = content["inputTranscription"]
                    if "text" in tx:
                        print(f"[Transcript]: {tx['text']}")
                if "turnComplete" in content:
                    print("[Turn Complete]")
    except websockets.exceptions.ConnectionClosed as e:
        print(f"WebSocket closed: {e.code} - {e.reason}")
    except Exception as e:
        print(f"Error receiving: {e}")

async def main():
    global API_KEY
    if len(sys.argv) > 1:
        API_KEY = sys.argv[1]
        
    await download_audio()
    
    ws_url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={API_KEY}"
    print(f"Connecting to Live API WebSocket (Model: {MODEL})...")
    
    try:
        async with websockets.connect(ws_url) as ws:
            print("Connected. Sending setup config...")
            
            # Send setup config
            setup_payload = {
                "setup": {
                    "model": f"models/{MODEL}",
                    "generationConfig": {
                        "responseModalities": ["AUDIO"]
                    },
                    "inputAudioTranscription": {},
                    "systemInstruction": {
                        "parts": [{
                            "text": "You are a silent listener. Do not speak, do not respond, do not generate any audio output. Simply listen to the audio input."
                        }]
                    }
                }
            }
            await ws.send(json.dumps(setup_payload))
            
            # Keep receiving responses
            await receive_responses(ws)
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
