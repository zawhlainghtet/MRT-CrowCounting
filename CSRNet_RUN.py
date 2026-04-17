import torch
import torch.nn as nn
from torchvision import models
from PIL import Image
import torchvision.transforms as transforms
import numpy as np
import cv2
import json
import sys
import os

# --- Setup Device and Model ---
device = "cuda" if torch.cuda.is_available() else "cpu"

# CSRNet Model Definition
class CSRNet(nn.Module):
    def __init__(self, load_vgg=False):
        super().__init__()
        vgg = models.vgg16(weights=models.VGG16_Weights.DEFAULT if load_vgg else None)
        feats = list(vgg.features.children())
        self.frontend = nn.Sequential(*feats[:23])
        self.backend = nn.Sequential(
            nn.Conv2d(512,512,3,padding=2,dilation=2), nn.ReLU(True),
            nn.Conv2d(512,512,3,padding=2,dilation=2), nn.ReLU(True),
            nn.Conv2d(512,512,3,padding=2,dilation=2), nn.ReLU(True),
            nn.Conv2d(512,256,3,padding=2,dilation=2), nn.ReLU(True),
            nn.Conv2d(256,128,3,padding=2,dilation=2), nn.ReLU(True),
            nn.Conv2d(128, 64,3,padding=2,dilation=2), nn.ReLU(True),
        )
        self.output_layer = nn.Conv2d(64, 1, 1)

    def forward(self, x):
        x = self.frontend(x)
        x = self.backend(x)
        return self.output_layer(x)

# Load the model
model = CSRNet(load_vgg=False).to(device).eval()

# Get script directory for model weights (supports both dev and pkg)
script_dir = os.path.dirname(os.path.abspath(__file__))
WEIGHTS_PATH = os.path.join(script_dir, "PartBmodel_best.pth.tar")

if not os.path.exists(WEIGHTS_PATH):
    result = {
        "success": False,
        "error": f"Model weights not found at {WEIGHTS_PATH}",
        "headCount": 0,
        "zones": {},
        "processingTime": 0
    }
    print(json.dumps(result))
    sys.exit(1)

try:
    ckpt = torch.load(WEIGHTS_PATH, map_location=device, weights_only=False)
    state = ckpt["state_dict"] if isinstance(ckpt, dict) and "state_dict" in ckpt else ckpt
    state = {k.replace("module.", ""): v for k, v in state.items()}
    model.load_state_dict(state, strict=False)
except Exception as e:
    result = {
        "success": False,
        "error": f"Failed to load model: {str(e)}",
        "headCount": 0,
        "zones": {},
        "processingTime": 0
    }
    print(json.dumps(result))
    sys.exit(1)

# Image transformation
transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225])
])

def csrnet_count(image_path):
    """Returns total head count (sum of density map)"""
    img = Image.open(image_path).convert("RGB")
    img_tensor = transform(img).unsqueeze(0).to(device)

    with torch.no_grad():
        density_map = model(img_tensor)

    count = density_map.sum().item()
    return count

def csrnet_zone_count(image_path):
    """Returns zone-based counts and total count"""
    img_pil = Image.open(image_path).convert("RGB")
    img = np.array(img_pil)
    h, w, _ = img.shape

    img_tensor = transform(img_pil).unsqueeze(0).to(device)
    with torch.no_grad():
        density = model(img_tensor)

    density = density.squeeze().cpu().numpy()
    density_h, density_w = density.shape

    far_zone = np.array([
        [int(0.35*w), int(0.05*h)],
        [int(0.65*w), int(0.05*h)],
        [int(0.75*w), int(0.25*h)],
        [int(0.25*w), int(0.25*h)]
    ])

    stand_zone = np.array([
        [int(0.25*w), int(0.25*h)],
        [int(0.75*w), int(0.25*h)],
        [int(0.85*w), int(0.85*h)],
        [int(0.15*w), int(0.85*h)]
    ])

    seat_left = np.array([
        [0, int(0.45*h)],
        [int(0.25*w), int(0.25*h)],
        [int(0.15*w), int(0.85*h)],
        [0, h]
    ])

    seat_right = np.array([
        [w, int(0.45*h)],
        [int(0.75*w), int(0.25*h)],
        [int(0.85*w), int(0.85*h)],
        [w, h]
    ])

    zones = {
        "far": far_zone,
        "stand": stand_zone,
        "seat_left": seat_left,
        "seat_right": seat_right
    }

    counts = {}
    for name, poly in zones.items():
        mask_original_res = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(mask_original_res, [poly], 1)
        mask_density_res = cv2.resize(mask_original_res, (density_w, density_h), interpolation=cv2.INTER_NEAREST)

        count = density[mask_density_res == 1].sum()
        counts[name] = int(round(count))

    total = sum(counts.values())
    return {"total": total, "zones": counts}

def process_image(image_path):
    """Main processing function - returns JSON result"""
    if not os.path.exists(image_path):
        return {
            "success": False,
            "error": f"Image file not found: {image_path}",
            "headCount": 0,
            "zones": {},
            "processingTime": 0
        }

    start_time = np.datetime64('now').astype('int64')

    try:
        # Get total count
        head_count = csrnet_count(image_path)

        # Get zone counts
        zone_result = csrnet_zone_count(image_path)

        end_time = np.datetime64('now').astype('int64')
        processing_time = int((end_time - start_time) / 1000000)  # Convert to ms

        return {
            "success": True,
            "headCount": int(round(head_count)),
            "confidence": 1.0,  # CSRNet doesn't provide confidence, use 1.0
            "zones": zone_result["zones"],
            "total": zone_result["total"],
            "processingTime": processing_time
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "headCount": 0,
            "zones": {},
            "processingTime": 0
        }

# --- CLI Entry Point ---
if __name__ == '__main__':
    if len(sys.argv) < 2:
        result = {
            "success": False,
            "error": "Usage: python CSRNet_RUN.py <image_path>",
            "headCount": 0,
            "zones": {},
            "processingTime": 0
        }
        print(json.dumps(result))
        sys.exit(1)

    image_path = sys.argv[1]
    result = process_image(image_path)
    print(json.dumps(result))
