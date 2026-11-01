"""
Comprehensive automated tests for CivicSense Role-Based Authentication
"""
import unittest
import json
import os
import sys

# Ensure project path is accessible
sys.path.insert(0, r"c:\Users\VICTUS\New folder\CivicSenseNew")

from app import app, load_users, save_users, get_users_path, load_complaints, save_complaints

class TestAuthAndRoles(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.app_context = app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_01_login_page_renders(self):
        res = self.client.get("/login")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"Portal Authentication", res.data)
        self.assertIn(b"Municipal Officer", res.data)
        self.assertIn(b"Citizen", res.data)
        self.assertIn(b"officer@civisense.gov", res.data)
        self.assertIn(b"citizen@civisense.org", res.data)

    def test_02_auth_me_unauthenticated(self):
        res = self.client.get("/api/auth/me")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertFalse(data.get("authenticated"))
        self.assertIsNone(data.get("user"))

    def test_03_officer_login_and_privileges(self):
        # 1. Login as Officer
        res = self.client.post("/api/auth/login", json={
            "email": "officer@civisense.gov",
            "password": "officer123"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data["user"]["role"], "officer")
        self.assertEqual(data["user"]["email"], "officer@civisense.gov")

        # 2. Check /api/auth/me
        me_res = self.client.get("/api/auth/me")
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.get_json()
        self.assertTrue(me_data.get("authenticated"))
        self.assertEqual(me_data["user"]["role"], "officer")

        # 3. Create a test complaint and update status as officer
        create_res = self.client.post("/api/complaints", json={
            "description": "Hazardous road sinkhole near north gate",
            "location": "North Gate Junction"
        })
        self.assertEqual(create_res.status_code, 201)
        cid = create_res.get_json()["complaint"]["id"]

        # Officer updates to In Progress
        patch_res = self.client.patch(f"/api/complaints/{cid}", json={
            "status": "In Progress"
        })
        self.assertEqual(patch_res.status_code, 200)
        self.assertEqual(patch_res.get_json()["complaint"]["status"], "In Progress")

        # 4. Logout
        logout_res = self.client.post("/api/auth/logout")
        self.assertEqual(logout_res.status_code, 200)

        # 5. Check me after logout
        me_after = self.client.get("/api/auth/me")
        self.assertFalse(me_after.get_json().get("authenticated"))

    def test_04_citizen_login_and_status_patch_forbidden(self):
        # 1. Login as Citizen
        res = self.client.post("/api/auth/login", json={
            "email": "citizen@civisense.org",
            "password": "citizen123"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["user"]["role"], "citizen")

        # 2. Citizen can submit a complaint
        create_res = self.client.post("/api/complaints", json={
            "description": "Overflowing public waste bin near market",
            "location": "Central Market Sector 4"
        })
        self.assertEqual(create_res.status_code, 201)
        c_obj = create_res.get_json()["complaint"]
        cid = c_obj["id"]
        # Author name should be attached from session
        self.assertEqual(c_obj.get("author_name"), "Rahul Verma")

        # 3. Citizen attempts to change status to Resolved -> MUST return HTTP 403 Forbidden!
        patch_res = self.client.patch(f"/api/complaints/{cid}", json={
            "status": "Resolved"
        })
        self.assertEqual(patch_res.status_code, 403)
        err_data = patch_res.get_json()
        self.assertFalse(err_data.get("success"))
        self.assertIn("officers", err_data.get("error", "").lower())

    def test_05_citizen_registration(self):
        import time
        test_email = f"newcitizen_{int(time.time())}@civisense.org"
        # Register new citizen
        res = self.client.post("/api/auth/register", json={
            "name": "Sunita Rao",
            "email": test_email,
            "password": "mypassword123",
            "phone": "+91 98765 43210"
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data["user"]["role"], "citizen")
        self.assertEqual(data["user"]["name"], "Sunita Rao")

        # Session should immediately be active
        me_res = self.client.get("/api/auth/me")
        self.assertEqual(me_res.status_code, 200)
        self.assertEqual(me_res.get_json()["user"]["email"], test_email)

        # Duplicate email should be rejected (409 Conflict)
        dup_res = self.client.post("/api/auth/register", json={
            "name": "Duplicate User",
            "email": test_email,
            "password": "mypassword123"
        })
        self.assertEqual(dup_res.status_code, 409)

if __name__ == "__main__":
    unittest.main()
