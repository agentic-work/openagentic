#!/usr/bin/env python3
# Copyright 2026 Gnomus.ai
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Azure AD OAuth2 Authentication for MCP Proxy

Implements OAuth2 + PKCE flow for Azure AD authentication.
Reuses the same Azure AD app registration as the main application.
"""

import os
import secrets
import hashlib
import base64
import logging
import json
from typing import Dict, Optional, Any
from datetime import datetime, timedelta
import msal
import jwt
import redis

logger = logging.getLogger("azure-oauth")


class AzureOAuthService:
    """Handles Azure AD OAuth2 authentication with PKCE"""

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.disabled = False

        # Load Azure AD config from environment (same as main app)
        self.tenant_id = os.getenv("AZURE_AD_TENANT_ID")
        self.client_id = os.getenv("AZURE_AD_CLIENT_ID")
        self.client_secret = os.getenv("AZURE_AD_CLIENT_SECRET")
        self.redirect_uri = os.getenv("MCP_PROXY_REDIRECT_URI", "http://localhost:8080/auth/callback")

        if not all([self.tenant_id, self.client_id, self.client_secret]):
            import logging
            logging.getLogger("mcp-proxy").warning(
                "Azure AD configuration incomplete (missing AZURE_AD_CLIENT_SECRET). "
                "OAuth/OBO token exchange will be disabled. Tools requiring Azure AD "
                "auth will use passthrough tokens from the API."
            )
            self.disabled = True
            self.authority = ""
            self.msal_app = None
            return

        self.authority = f"https://login.microsoftonline.com/{self.tenant_id}"

        # Scopes for Azure AD + Microsoft Graph
        self.scopes = [
            "https://management.azure.com/.default",  # Azure Resource Manager
            "User.Read",  # Microsoft Graph
            "openid",
            "profile",
            "email",
            "offline_access"  # Get refresh token
        ]

        # Create MSAL confidential client app
        self.msal_app = msal.ConfidentialClientApplication(
            client_id=self.client_id,
            client_credential=self.client_secret,
            authority=self.authority
        )

        logger.info(f"Azure OAuth initialized - Tenant: {self.tenant_id}, Redirect: {self.redirect_uri}")

    def generate_pkce_challenge(self) -> tuple[str, str]:
        """
        Generate PKCE code verifier and challenge

        Returns:
            (code_verifier, code_challenge) tuple
        """
        # Generate random code verifier (43-128 characters)
        code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('utf-8').rstrip('=')

        # Create SHA256 hash of verifier for challenge
        challenge = hashlib.sha256(code_verifier.encode('utf-8')).digest()
        code_challenge = base64.urlsafe_b64encode(challenge).decode('utf-8').rstrip('=')

        return code_verifier, code_challenge

    def generate_auth_url(self) -> Dict[str, str]:
        """
        Generate Azure AD authorization URL with PKCE

        Returns:
            Dict with 'auth_url' and 'state'
        """
        # Generate PKCE pair
        code_verifier, code_challenge = self.generate_pkce_challenge()

        # Generate random state for CSRF protection
        state = secrets.token_urlsafe(32)

        # Store code_verifier in Redis with state as key (expires in 10 minutes)
        self.redis.setex(
            f"pkce:{state}",
            600,  # 10 minutes
            code_verifier
        )

        # Build authorization URL
        auth_url = self.msal_app.get_authorization_request_url(
            scopes=self.scopes,
            state=state,
            redirect_uri=self.redirect_uri,
            code_challenge=code_challenge,
            code_challenge_method="S256"
        )

        logger.info(f"Generated auth URL with state: {state}")

        return {
            "auth_url": auth_url,
            "state": state
        }

    def exchange_code_for_token(self, code: str, state: str) -> Dict[str, Any]:
        """
        Exchange authorization code for access token

        Args:
            code: Authorization code from Azure AD callback
            state: State parameter for CSRF validation

        Returns:
            Dict with token information
        """
        # Retrieve code_verifier from Redis
        code_verifier = self.redis.get(f"pkce:{state}")

        if not code_verifier:
            raise ValueError("Invalid or expired state parameter")

        code_verifier = code_verifier.decode('utf-8')

        # Exchange code for tokens using MSAL
        result = self.msal_app.acquire_token_by_authorization_code(
            code=code,
            scopes=self.scopes,
            redirect_uri=self.redirect_uri,
            code_verifier=code_verifier
        )

        # Clean up used code_verifier
        self.redis.delete(f"pkce:{state}")

        if "error" in result:
            error_msg = result.get("error_description", result.get("error"))
            logger.error(f"Token exchange failed: {error_msg}")
            raise RuntimeError(f"Failed to acquire token: {error_msg}")

        logger.info("Successfully exchanged code for tokens")

        return {
            "access_token": result["access_token"],
            "refresh_token": result.get("refresh_token"),
            "id_token": result.get("id_token"),
            "expires_in": result.get("expires_in", 3600),
            "token_type": result.get("token_type", "Bearer")
        }

    def decode_token(self, token: str) -> Dict[str, Any]:
        """
        Decode JWT token without validation (for extracting claims)

        Args:
            token: JWT access token

        Returns:
            Dict with token claims
        """
        try:
            # Decode without verification (we trust tokens from MSAL)
            decoded = jwt.decode(token, options={"verify_signature": False})
            return decoded
        except Exception as e:
            logger.error(f"Failed to decode token: {str(e)}")
            raise ValueError(f"Invalid token format: {str(e)}")

    def extract_user_info(self, tokens: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract user information from tokens

        Args:
            tokens: Token dict from exchange_code_for_token

        Returns:
            Dict with user information
        """
        access_token = tokens["access_token"]
        claims = self.decode_token(access_token)

        user_info = {
            "user_id": claims.get("oid") or claims.get("sub"),
            "email": claims.get("preferred_username") or claims.get("upn") or claims.get("email"),
            "name": claims.get("name", ""),
            "tenant_id": claims.get("tid"),
            "token_expires": datetime.utcnow() + timedelta(seconds=tokens.get("expires_in", 3600)),
            "access_token": access_token,
            "refresh_token": tokens.get("refresh_token")
        }

        logger.info(f"Extracted user info: {user_info['email']} ({user_info['user_id']})")

        return user_info

    def create_session(self, user_info: Dict[str, Any]) -> str:
        """
        Create a user session in Redis

        Args:
            user_info: User information dict

        Returns:
            Session ID
        """
        session_id = secrets.token_urlsafe(32)

        # Store session in Redis (expires in 24 hours)
        session_data = {
            "user_id": user_info["user_id"],
            "email": user_info["email"],
            "name": user_info["name"],
            "tenant_id": user_info["tenant_id"],
            "access_token": user_info["access_token"],
            "refresh_token": user_info.get("refresh_token"),
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": user_info["token_expires"].isoformat()
        }

        self.redis.setex(
            f"session:{session_id}",
            86400,  # 24 hours
            json.dumps(session_data)
        )

        logger.info(f"Created session {session_id} for user {user_info['email']}")

        return session_id

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve session data from Redis

        Args:
            session_id: Session ID

        Returns:
            Session data dict or None if not found
        """
        session_data = self.redis.get(f"session:{session_id}")

        if not session_data:
            return None

        return json.loads(session_data.decode('utf-8'))

    def delete_session(self, session_id: str) -> bool:
        """
        Delete a session from Redis

        Args:
            session_id: Session ID

        Returns:
            True if deleted, False if not found
        """
        result = self.redis.delete(f"session:{session_id}")

        if result:
            logger.info(f"Deleted session {session_id}")

        return bool(result)

    def refresh_token(self, refresh_token: str) -> Dict[str, Any]:
        """
        Refresh an expired access token

        Args:
            refresh_token: Refresh token

        Returns:
            New token dict
        """
        result = self.msal_app.acquire_token_by_refresh_token(
            refresh_token=refresh_token,
            scopes=self.scopes
        )

        if "error" in result:
            error_msg = result.get("error_description", result.get("error"))
            logger.error(f"Token refresh failed: {error_msg}")
            raise RuntimeError(f"Failed to refresh token: {error_msg}")

        logger.info("Successfully refreshed access token")

        return {
            "access_token": result["access_token"],
            "refresh_token": result.get("refresh_token"),
            "expires_in": result.get("expires_in", 3600),
            "token_type": result.get("token_type", "Bearer")
        }
