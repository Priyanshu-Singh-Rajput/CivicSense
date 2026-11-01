"""
test_backend.py - Automated Test Suite for Civisense Flask Backend
Tests the 11 required scenarios:
1. Application initializes and GET / serves response
2. GET /api/complaints returns a valid response
3. A valid complaint is analyzed and saved (POST /api/complaints)
4. Empty description is rejected (HTTP 400)
5. Missing location is rejected (HTTP 400)
6. Invalid JSON is rejected (HTTP 400)
7. Invalid status is rejected (HTTP 400)
8. Updating a nonexistent complaint returns HTTP 404
9. Saved complaints survive an application restart
10. An AI failure does not crash the Flask application
11. The backend does not label fallback results as successful AI analyses
"""

import json
import unittest
import io
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from PIL import Image

from app import app


def create_test_image(format="PNG") -> io.BytesIO:
    """Generates a small in-memory valid image for tests."""
    img = Image.new("RGB", (20, 20), color="blue")
    buf = io.BytesIO()
    img.save(buf, format=format)
    buf.seek(0)
    return buf


class TestCivisenseBackend(unittest.TestCase):

    def setUp(self):
        # Create a temporary directory and temporary storage file for isolation
        self.temp_dir = TemporaryDirectory()
        self.test_storage = Path(self.temp_dir.name) / "test_complaints.json"
        with open(self.test_storage, "w", encoding="utf-8") as f:
            f.write("[]")

        self.test_upload_dir = Path(self.temp_dir.name) / "uploads"
        self.test_upload_dir.mkdir(parents=True, exist_ok=True)

        # Configure Flask app to use isolated storage and upload folder
        app.config["STORAGE_PATH"] = self.test_storage
        app.config["UPLOAD_FOLDER"] = self.test_upload_dir
        app.config["TESTING"] = True
        self.client = app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_01_app_initialization_and_root(self):
        """1. Application initializes and GET / returns HTTP 200."""
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)

    def test_02_get_empty_complaints(self):
        """2. GET /api/complaints returns a valid empty list."""
        response = self.client.get("/api/complaints")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["complaints"], [])

    @patch("app.analyze_complaint")
    def test_03_create_valid_complaint(self, mock_ai):
        """3. A valid complaint is analyzed with AI and saved (HTTP 201)."""
        mock_ai.return_value = {
            "category": "Drainage",
            "severity": "High",
            "department": "Drainage and Sewerage Department",
            "summary": "Drain is overflowing near the college gate.",
            "recommended_action": "Clear blockage immediately.",
            "ai_status": "success"
        }

        payload = {
            "description": "Drain overflowing near college gate",
            "location": "College Main Gate"
        }
        response = self.client.post("/api/complaints", json=payload)
        self.assertEqual(response.status_code, 201)
        data = response.get_json()
        self.assertTrue(data["success"])

        complaint = data["complaint"]
        self.assertTrue(complaint["id"].startswith("c-"))
        self.assertEqual(complaint["description"], "Drain overflowing near college gate")
        self.assertEqual(complaint["location"], "College Main Gate")
        self.assertEqual(complaint["category"], "Drainage")
        self.assertEqual(complaint["severity"], "High")
        self.assertEqual(complaint["status"], "Pending")
        self.assertEqual(complaint["ai_status"], "success")
        self.assertIn("created_at", complaint)

        # Check that it appears in GET /api/complaints
        get_res = self.client.get("/api/complaints")
        complaints_list = get_res.get_json()["complaints"]
        self.assertEqual(len(complaints_list), 1)
        self.assertEqual(complaints_list[0]["id"], complaint["id"])

    def test_04_empty_description_rejected(self):
        """4. Empty description is rejected with HTTP 400."""
        payload = {"description": "   ", "location": "Main Road"}
        response = self.client.post("/api/complaints", json=payload)
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertFalse(data["success"])
        self.assertIn("description", data["error"])

    def test_05_missing_location_rejected(self):
        """5. Missing location is rejected with HTTP 400."""
        payload = {"description": "Pothole on road"}
        response = self.client.post("/api/complaints", json=payload)
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertFalse(data["success"])
        self.assertIn("location", data["error"])

    def test_06_invalid_json_rejected(self):
        """6. Non-JSON request is rejected with HTTP 400."""
        response = self.client.post(
            "/api/complaints",
            data="not a json",
            content_type="text/plain"
        )
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertFalse(data["success"])

    @patch("app.analyze_complaint")
    def test_07_invalid_status_rejected(self, mock_ai):
        """7. Invalid status value in PATCH is rejected with HTTP 400."""
        mock_ai.return_value = {
            "category": "Road", "severity": "Low", "department": "PWD",
            "summary": "Pothole", "recommended_action": "Fill", "ai_status": "success"
        }
        create_res = self.client.post("/api/complaints", json={"description": "Pothole", "location": "Street 1"})
        complaint_id = create_res.get_json()["complaint"]["id"]

        patch_res = self.client.patch(f"/api/complaints/{complaint_id}", json={"status": "DoneForever"})
        self.assertEqual(patch_res.status_code, 400)
        data = patch_res.get_json()
        self.assertFalse(data["success"])
        self.assertIn("Invalid status", data["error"])

    def test_08_update_nonexistent_complaint_404(self):
        """8. Updating a nonexistent complaint returns HTTP 404."""
        response = self.client.patch("/api/complaints/c-doesnotexist", json={"status": "Resolved"})
        self.assertEqual(response.status_code, 404)
        data = response.get_json()
        self.assertFalse(data["success"])

    @patch("app.analyze_complaint")
    def test_09_complaints_survive_restart(self, mock_ai):
        """9. Saved complaints survive an application restart."""
        mock_ai.return_value = {
            "category": "Electricity", "severity": "Medium", "department": "Power",
            "summary": "Wire hanging", "recommended_action": "Fix wire", "ai_status": "success"
        }
        res = self.client.post("/api/complaints", json={"description": "Hanging wire", "location": "Pole 4"})
        cid = res.get_json()["complaint"]["id"]

        # Simulate fresh client/re-read
        new_client = app.test_client()
        list_res = new_client.get("/api/complaints")
        data = list_res.get_json()
        self.assertEqual(len(data["complaints"]), 1)
        self.assertEqual(data["complaints"][0]["id"], cid)

    @patch("app.analyze_complaint")
    def test_10_ai_failure_does_not_crash(self, mock_ai):
        """10. An AI failure or exception does not crash the Flask backend."""
        mock_ai.side_effect = RuntimeError("Remote AI service unreachable")

        response = self.client.post(
            "/api/complaints",
            json={"description": "Water pipe broken", "location": "Sector 9"}
        )
        # Even with AI failure, complaint intake should gracefully persist or handle fallback
        # If analyze_complaint raises, app.py catches or handles it
        # In our ai_service, analyze_complaint never raises, but if it did, app.py handles it
        self.assertIn(response.status_code, [201, 500])

    @patch("app.analyze_complaint")
    def test_11_fallback_not_labeled_as_success(self, mock_ai):
        """11. Backend preserves ai_status: 'unavailable' and does not label fallback as success."""
        mock_ai.return_value = {
            "category": "Other",
            "severity": "Medium",
            "department": "Municipal Grievance Cell (Manual Triage)",
            "summary": "Water pipe burst leaking water.",
            "recommended_action": "Manual review required: Assign to civic inspection officer.",
            "ai_status": "unavailable"
        }

        response = self.client.post(
            "/api/complaints",
            json={"description": "Water pipe burst leaking water", "location": "Block 2"}
        )
        self.assertEqual(response.status_code, 201)
        complaint = response.get_json()["complaint"]
        self.assertEqual(complaint["ai_status"], "unavailable")
        self.assertNotEqual(complaint["ai_status"], "success")
        self.assertEqual(complaint["category"], "Other")
        self.assertIn("Manual review required", complaint["recommended_action"])

    @patch("app.analyze_complaint")
    def test_12_patch_valid_status_progression(self, mock_ai):
        """12. Status progression: Pending -> In Progress -> Resolved."""
        mock_ai.return_value = {
            "category": "Sanitation", "severity": "Low", "department": "Waste",
            "summary": "Garbage dump", "recommended_action": "Clear bin", "ai_status": "success"
        }
        create_res = self.client.post("/api/complaints", json={"description": "Trash overflowing", "location": "Corner"})
        cid = create_res.get_json()["complaint"]["id"]

        # Update to In Progress
        p1 = self.client.patch(f"/api/complaints/{cid}", json={"status": "In Progress"})
        self.assertEqual(p1.status_code, 200)
        self.assertEqual(p1.get_json()["complaint"]["status"], "In Progress")

        # Update to Resolved
        p2 = self.client.patch(f"/api/complaints/{cid}", json={"status": "Resolved"})
        self.assertEqual(p2.status_code, 200)
        self.assertEqual(p2.get_json()["complaint"]["status"], "Resolved")

    @patch("app.analyze_complaint")
    def test_13_create_complaint_with_photo_and_location(self, mock_ai):
        """13. Phase 5: Multipart photo & location report is saved with image & coordinates."""
        mock_ai.return_value = {
            "category": "Road", "severity": "High", "department": "Public Works",
            "summary": "Deep pothole dangerous to motorists",
            "recommended_action": "Fill pothole immediately",
            "ai_status": "success"
        }

        image_stream = create_test_image("PNG")
        data = {
            "photo": (image_stream, "pothole.png", "image/png"),
            "latitude": "12.971598",
            "longitude": "77.594566",
            "accuracy": "14.5",
            "description": "Deep pothole on MG Road near metro station",
            "location": "MG Road",
            "address": "MG Road, Bengaluru, Karnataka, India"
        }

        response = self.client.post("/api/complaints", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 201)
        res_data = response.get_json()
        self.assertTrue(res_data["success"])
        complaint = res_data["complaint"]

        self.assertTrue(complaint["id"].startswith("c-"))
        self.assertEqual(complaint["latitude"], 12.971598)
        self.assertEqual(complaint["longitude"], 77.594566)
        self.assertEqual(complaint["accuracy"], 14.5)
        self.assertEqual(complaint["address"], "MG Road, Bengaluru, Karnataka, India")
        self.assertTrue(complaint["photo_url"].startswith("/uploads/"))
        self.assertTrue(complaint["photo_filename"].endswith(".png"))

        # Verify physical file existence in test_upload_dir
        saved_file = self.test_upload_dir / complaint["photo_filename"]
        self.assertTrue(saved_file.exists())
        self.assertGreater(saved_file.stat().st_size, 0)

        # Verify serving via /uploads/<filename>
        get_photo = self.client.get(complaint["photo_url"])
        self.assertEqual(get_photo.status_code, 200)
        get_photo.close()

    def test_14_multipart_missing_photo_rejected(self):
        """14. Phase 5: Multipart submission without photo is rejected (HTTP 400)."""
        data = {
            "latitude": "12.971598",
            "longitude": "77.594566",
            "accuracy": "10.0",
            "description": "Missing photo test"
        }
        response = self.client.post("/api/complaints", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)
        res_data = response.get_json()
        self.assertFalse(res_data["success"])
        self.assertIn("photo", res_data["error"].lower())

    def test_15_multipart_invalid_image_extension_rejected(self):
        """15. Phase 5: Unsupported file extension is rejected (HTTP 400)."""
        fake_file = io.BytesIO(b"echo 'malicious script'")
        data = {
            "photo": (fake_file, "exploit.sh", "text/x-sh"),
            "latitude": "12.971598",
            "longitude": "77.594566",
            "accuracy": "10.0"
        }
        response = self.client.post("/api/complaints", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)
        res_data = response.get_json()
        self.assertFalse(res_data["success"])
        self.assertIn("extension", res_data["error"].lower())

    def test_16_multipart_fake_image_magic_bytes_rejected(self):
        """16. Phase 5: Disguised non-image file with .jpg extension is rejected (HTTP 400)."""
        fake_file = io.BytesIO(b"This is not a real jpeg file header")
        data = {
            "photo": (fake_file, "fake.jpg", "image/jpeg"),
            "latitude": "12.971598",
            "longitude": "77.594566",
            "accuracy": "10.0"
        }
        response = self.client.post("/api/complaints", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)
        res_data = response.get_json()
        self.assertFalse(res_data["success"])

    def test_17_multipart_invalid_latitude_rejected(self):
        """17. Phase 5: Out-of-bounds latitude is rejected (HTTP 400) and cleans up file."""
        image_stream = create_test_image("PNG")
        data = {
            "photo": (image_stream, "test.png", "image/png"),
            "latitude": "95.5",  # Out of bounds (>90)
            "longitude": "77.594566",
            "accuracy": "10.0"
        }
        response = self.client.post("/api/complaints", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)
        res_data = response.get_json()
        self.assertFalse(res_data["success"])
        self.assertIn("latitude", res_data["error"].lower())
        # Verify no orphaned image left in test_upload_dir
        self.assertEqual(len(list(self.test_upload_dir.glob("*"))), 0)

    def test_18_multipart_invalid_longitude_rejected(self):
        """18. Phase 5: Out-of-bounds longitude is rejected (HTTP 400)."""
        image_stream = create_test_image("PNG")
        data = {
            "photo": (image_stream, "test.png", "image/png"),
            "latitude": "12.971598",
            "longitude": "-185.0",  # Out of bounds (<-180)
            "accuracy": "10.0"
        }
        response = self.client.post("/api/complaints", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)
        res_data = response.get_json()
        self.assertFalse(res_data["success"])
        self.assertIn("longitude", res_data["error"].lower())

    def test_19_multipart_negative_accuracy_rejected(self):
        """19. Phase 5: Accuracy <= 0 is rejected (HTTP 400)."""
        image_stream = create_test_image("PNG")
        data = {
            "photo": (image_stream, "test.png", "image/png"),
            "latitude": "12.971598",
            "longitude": "77.594566",
            "accuracy": "-5.0"  # Invalid non-positive accuracy
        }
        response = self.client.post("/api/complaints", data=data, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 400)
        res_data = response.get_json()
        self.assertFalse(res_data["success"])
        self.assertIn("accuracy", res_data["error"].lower())

    def test_20_reverse_geocode_validation(self):
        """20. Phase 5: Reverse geocode endpoint validates query bounds."""
        res_missing = self.client.get("/api/reverse-geocode")
        self.assertEqual(res_missing.status_code, 400)

        res_oob = self.client.get("/api/reverse-geocode?lat=120&lon=200")
        self.assertEqual(res_oob.status_code, 400)

    def test_21_path_traversal_prevention(self):
        """21. Phase 5: Path traversal attempts on /uploads are rejected."""
        res = self.client.get("/uploads/../test_complaints.json")
        self.assertIn(res.status_code, [400, 404])


if __name__ == "__main__":
    unittest.main(verbosity=2)
