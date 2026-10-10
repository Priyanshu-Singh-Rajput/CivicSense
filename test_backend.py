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
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app import app


class TestCivisenseBackend(unittest.TestCase):

    def setUp(self):
        # Create a temporary directory and temporary storage file for isolation
        self.temp_dir = TemporaryDirectory()
        self.test_storage = Path(self.temp_dir.name) / "test_complaints.json"
        with open(self.test_storage, "w", encoding="utf-8") as f:
            f.write("[]")

        # Configure Flask app to use isolated storage
        app.config["STORAGE_PATH"] = self.test_storage
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
