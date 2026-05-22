

"""
Per-User Azure MCP Session Manager

Manages isolated Azure MCP instances for each user with their OBO token.
Each user gets their own azmcp process with their Azure credentials.
"""

import asyncio
import logging
import os
import subprocess
import time
from typing import Dict, Optional, Any, List
from dataclasses import dataclass
from datetime import datetime, timedelta

logger = logging.getLogger("user-session-manager")

@dataclass
class UserSession:
    """Represents a per-user Azure MCP session"""
    user_id: str
    email: str
    process: subprocess.Popen
    access_token: str
    created_at: datetime
    last_accessed_at: datetime
    tools: List[Dict[str, Any]] = None

    def is_stale(self, max_idle_minutes: int = 60) -> bool:
        """Check if session has been idle too long"""
        idle_time = datetime.now() - self.last_accessed_at
        return idle_time > timedelta(minutes=max_idle_minutes)

    def is_alive(self) -> bool:
        """Check if the process is still running"""
        return self.process and self.process.poll() is None

class UserSessionManager:
    """Manages per-user Azure MCP sessions"""

    def __init__(self):
        self.sessions: Dict[str, UserSession] = {}
        self.cleanup_task: Optional[asyncio.Task] = None

    async def start_user_session(
        self,
        user_id: str,
        email: str,
        access_token: str
    ) -> Dict[str, Any]:
        """
        Start a new Azure MCP session for a user

        Args:
            user_id: Unique user identifier
            email: User's email address
            access_token: User's Azure OBO access token

        Returns:
            Session info including tools available
        """
        # Check if user already has an active session
        if user_id in self.sessions:
            existing_session = self.sessions[user_id]
            if existing_session.is_alive():
                logger.info(f"[USER_SESSION] User {user_id} already has active session, reusing")
                existing_session.last_accessed_at = datetime.now()
                return {
                    "status": "existing",
                    "user_id": user_id,
                    "email": email,
                    "tools": existing_session.tools or [],
                    "created_at": existing_session.created_at.isoformat()
                }
            else:
                logger.warning(f"[USER_SESSION] Found dead session for {user_id}, cleaning up")
                await self.stop_user_session(user_id)

        logger.info(f"[USER_SESSION] Starting new Azure MCP session for user {user_id} ({email})")

        try:
            # Spawn azmcp process with user's OBO token
            #
            # APPROACH: Use the npm @azure/mcp package which supports the
            # Azure Identity library. We pass the user's access token via
            # environment variables that Azure Identity can use.
            #
            # The key is using AZURE_CLIENT_ID + AZURE_CLIENT_SECRET + AZURE_TENANT_ID
            # for the service principal that will perform OBO token exchange.
            # Then we store the user's token for the OBO flow.
            #
            # Reference: https://medium.com/@khansaima/securing-mcp-tools-with-azure-ad-on-behalf-of-obo-29b1ada1e505
            env = os.environ.copy()

            # Service Principal credentials for OBO token exchange
            # These should be set in the MCP Proxy environment
            # The SP needs "Delegated Permissions" for the Azure resources
            if not all([
                os.getenv("AZURE_CLIENT_ID"),
                os.getenv("AZURE_CLIENT_SECRET"),
                os.getenv("AZURE_TENANT_ID")
            ]):
                raise RuntimeError(
                    "Azure SP credentials not configured. Set AZURE_CLIENT_ID, "
                    "AZURE_CLIENT_SECRET, and AZURE_TENANT_ID in MCP Proxy environment"
                )

            # Pass user's access token for OBO exchange
            # The custom Azure MCP implementation will use this to perform OBO
            env.update({
                "USER_ACCESS_TOKEN": access_token,  # User's token for OBO exchange
                "USER_ID": user_id,  # For logging/tracking
                "USER_EMAIL": email,
                "AZURE_TOKEN_CREDENTIALS": "prod"  # Production mode
            })

            # Start azmcp server in stdio mode
            process = subprocess.Popen(
                ["azmcp", "server", "start"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                text=True,
                bufsize=0  # Unbuffered for real-time communication
            )

            # Give it a moment to start
            await asyncio.sleep(2)

            if process.poll() is not None:
                stderr = process.stderr.read() if process.stderr else "No error output"
                raise RuntimeError(f"Azure MCP process failed to start: {stderr}")

            logger.info(f"[USER_SESSION] Azure MCP process started for {user_id} (PID: {process.pid})")

            # Query tools list from the user's instance
            tools = await self._get_tools_from_process(process)
            logger.info(f"[USER_SESSION] Retrieved {len(tools)} tools from {user_id}'s Azure MCP")

            # Create and store session
            session = UserSession(
                user_id=user_id,
                email=email,
                process=process,
                access_token=access_token,
                created_at=datetime.now(),
                last_accessed_at=datetime.now(),
                tools=tools
            )
            self.sessions[user_id] = session

            return {
                "status": "created",
                "user_id": user_id,
                "email": email,
                "tools": tools,
                "created_at": session.created_at.isoformat(),
                "pid": process.pid
            }

        except Exception as e:
            logger.error(f"[USER_SESSION] Failed to start session for {user_id}: {str(e)}")
            raise

    async def stop_user_session(self, user_id: str) -> bool:
        """
        Stop and cleanup a user's Azure MCP session

        Args:
            user_id: User identifier

        Returns:
            True if session was stopped, False if no session existed
        """
        if user_id not in self.sessions:
            logger.warning(f"[USER_SESSION] No session found for user {user_id}")
            return False

        session = self.sessions[user_id]
        logger.info(f"[USER_SESSION] Stopping Azure MCP session for {user_id}")

        # Terminate the process
        if session.process and session.process.poll() is None:
            try:
                session.process.terminate()
                # Wait up to 5 seconds for graceful shutdown
                try:
                    await asyncio.wait_for(
                        asyncio.to_thread(session.process.wait),
                        timeout=5.0
                    )
                except asyncio.TimeoutError:
                    logger.warning(f"[USER_SESSION] Force killing Azure MCP for {user_id}")
                    session.process.kill()
                    await asyncio.to_thread(session.process.wait)

                logger.info(f"[USER_SESSION] Process terminated for {user_id}")
            except Exception as e:
                logger.error(f"[USER_SESSION] Error terminating process for {user_id}: {str(e)}")

        # Remove from sessions
        del self.sessions[user_id]
        logger.info(f"[USER_SESSION] Session cleaned up for {user_id}")
        return True

    async def get_session(self, user_id: str) -> Optional[UserSession]:
        """Get a user's session and update last accessed time"""
        session = self.sessions.get(user_id)
        if session:
            session.last_accessed_at = datetime.now()
        return session

    async def send_request_to_user_session(
        self,
        user_id: str,
        request: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Send an MCP request to a user's Azure MCP instance

        Args:
            user_id: User identifier
            request: JSON-RPC request dict

        Returns:
            JSON-RPC response dict
        """
        session = await self.get_session(user_id)
        if not session:
            raise RuntimeError(f"No active session for user {user_id}")

        if not session.is_alive():
            raise RuntimeError(f"Session process for user {user_id} is not running")

        try:
            # Send request via stdin
            request_json = json.dumps(request) + "\n"
            session.process.stdin.write(request_json)
            session.process.stdin.flush()

            # Read response from stdout with timeout
            response_data = ""
            start_time = time.time()
            timeout = 30  # 30 second timeout

            while time.time() - start_time < timeout:
                if session.process.stdout.readable():
                    line = session.process.stdout.readline()
                    if line:
                        response_data += line
                        try:
                            response = json.loads(response_data)
                            if response.get("id") == request.get("id"):
                                return response
                        except json.JSONDecodeError:
                            continue
                await asyncio.sleep(0.1)

            raise TimeoutError(f"Request to user {user_id}'s Azure MCP timed out")

        except Exception as e:
            logger.error(f"[USER_SESSION] Error sending request to {user_id}: {str(e)}")
            raise

    async def list_sessions(self) -> List[Dict[str, Any]]:
        """List all active sessions"""
        return [
            {
                "user_id": session.user_id,
                "email": session.email,
                "created_at": session.created_at.isoformat(),
                "last_accessed": session.last_accessed_at.isoformat(),
                "is_alive": session.is_alive(),
                "tool_count": len(session.tools) if session.tools else 0,
                "pid": session.process.pid if session.process else None
            }
            for session in self.sessions.values()
        ]

    async def cleanup_stale_sessions(self, max_idle_minutes: int = 60):
        """Remove sessions that have been idle too long"""
        stale_user_ids = [
            user_id
            for user_id, session in self.sessions.items()
            if session.is_stale(max_idle_minutes) or not session.is_alive()
        ]

        for user_id in stale_user_ids:
            logger.info(f"[USER_SESSION] Cleaning up stale session for {user_id}")
            await self.stop_user_session(user_id)

        if stale_user_ids:
            logger.info(f"[USER_SESSION] Cleaned up {len(stale_user_ids)} stale sessions")

    async def start_periodic_cleanup(self, interval_minutes: int = 15):
        """Start background task for periodic cleanup"""
        async def cleanup_loop():
            while True:
                try:
                    await asyncio.sleep(interval_minutes * 60)
                    await self.cleanup_stale_sessions()
                except Exception as e:
                    logger.error(f"[USER_SESSION] Periodic cleanup error: {str(e)}")

        self.cleanup_task = asyncio.create_task(cleanup_loop())
        logger.info(f"[USER_SESSION] Started periodic cleanup (every {interval_minutes} minutes)")

    async def stop_periodic_cleanup(self):
        """Stop background cleanup task"""
        if self.cleanup_task:
            self.cleanup_task.cancel()
            try:
                await self.cleanup_task
            except asyncio.CancelledError:
                pass
            self.cleanup_task = None

    async def _get_tools_from_process(
        self,
        process: subprocess.Popen
    ) -> List[Dict[str, Any]]:
        """Query tools/list from an Azure MCP process via stdio"""
        import json

        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list"
        }

        try:
            # Send request
            request_json = json.dumps(request) + "\n"
            process.stdin.write(request_json)
            process.stdin.flush()

            # Read response with timeout
            response_data = ""
            start_time = time.time()
            timeout = 30

            while time.time() - start_time < timeout:
                if process.stdout.readable():
                    line = process.stdout.readline()
                    if line:
                        response_data += line
                        try:
                            response = json.loads(response_data)
                            if response.get("id") == 1 and "result" in response:
                                return response["result"].get("tools", [])
                        except json.JSONDecodeError:
                            continue
                await asyncio.sleep(0.1)

            logger.warning("[USER_SESSION] Timeout getting tools, returning empty list")
            return []

        except Exception as e:
            logger.error(f"[USER_SESSION] Error getting tools from process: {str(e)}")
            return []

# Global singleton instance
_user_session_manager: Optional[UserSessionManager] = None

def get_user_session_manager() -> UserSessionManager:
    """Get the global UserSessionManager instance"""
    global _user_session_manager
    if _user_session_manager is None:
        _user_session_manager = UserSessionManager()
    return _user_session_manager
