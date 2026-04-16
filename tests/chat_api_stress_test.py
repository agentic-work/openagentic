# Proprietary and confidential. Unauthorized copying prohibited.

"""
Chat API Stress Test - Test concurrent chat sessions with MCP tools and diagrams
"""

import json
import time
import requests
import concurrent.futures
from datetime import datetime
from typing import List, Dict, Any
import sys

# Configuration
API_BASE_URL = "http://localhost:8000"
ADMIN_EMAIL = "admin@openagentic.io"
ADMIN_PASSWORD = "6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3"
NUM_SESSIONS = 10
MESSAGES_PER_SESSION = 5
RESULTS_DIR = "/mnt/synology/Code/company/cdc/agentic/tests/results"

# Test questions that exercise different MCP tools and request diagrams
QUESTIONS = [
    # Azure MCP
    "List all my Azure subscriptions and resource groups",
    "Show me all virtual machines in my subscription",
    "What Azure resources are in my default resource group?",

    # Web MCP
    "Search the web for latest AWS Lambda pricing",
    "Fetch the content from https://docs.aws.amazon.com/lambda/latest/dg/welcome.html",

    # Memory MCP
    "Remember that I prefer Python for cloud automation scripts",
    "What programming languages do I prefer?",
    "Store this information: My team uses Azure DevOps for CI/CD",

    # AWS API MCP
    "List all my EC2 instances",
    "Show me my S3 buckets",

    # AWS Knowledge MCP
    "What is AWS Lambda and how does it work?",
    "Explain AWS IAM roles and policies",

    # Sequential Thinking MCP
    "Think through the architecture for a scalable web application step by step",
    "Analyze the pros and cons of microservices vs monolithic architecture",

    # Diagram requests (React Flow)
    "Draw a flowchart showing the CI/CD pipeline process",
    "Create a bar chart comparing AWS Lambda vs Azure Functions pricing",
    "Visualize a microservices architecture with API gateway, services, and databases",
    "Show me a pie chart of cloud market share between AWS, Azure, and GCP",
    "Create a network diagram showing VPC, subnets, and security groups",

    # GCP MCP
    "List all my Google Cloud projects",
    "Show me my GCP compute instances",

    # Azure Cost MCP
    "What are my Azure costs for the last month?",
    "Show me the most expensive Azure resources",

    # Flowise MCP
    "List all available Flowise workflows",
    "Show me details about my Flowise chatflows",

    # Complex multi-tool requests
    "Search the web for Azure best practices, then remember the top 3 for me",
    "List my AWS Lambda functions and create a bar chart showing their memory configurations",
    "Think through a disaster recovery plan for Azure, then draw a flowchart of the process"
]

def print_color(text: str, color: str):
    """Print colored text"""
    colors = {
        'blue': '\033[0;34m',
        'green': '\033[0;32m',
        'red': '\033[0;31m',
        'yellow': '\033[1;33m',
        'reset': '\033[0m'
    }
    print(f"{colors.get(color, '')}{text}{colors['reset']}")

def authenticate() -> str:
    """Authenticate and get token"""
    print_color(f"[INFO] Authenticating as {ADMIN_EMAIL}...", 'blue')

    try:
        response = requests.post(
            f"{API_BASE_URL}/api/auth/local/login",
            json={
                "username": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            },
            timeout=10
        )

        if response.status_code != 200:
            print_color(f"[ERROR] Authentication failed: {response.status_code}", 'red')
            print_color(f"[ERROR] Response: {response.text}", 'red')
            sys.exit(1)

        data = response.json()
        token = data.get('token') or data.get('access_token')

        if not token:
            print_color(f"[ERROR] No token in response: {data}", 'red')
            sys.exit(1)

        print_color("[SUCCESS] Authentication successful", 'green')
        return token

    except Exception as e:
        print_color(f"[ERROR] Authentication exception: {e}", 'red')
        sys.exit(1)

def send_chat_message(token: str, session_id: str, message: str, session_idx: int, msg_idx: int) -> Dict[str, Any]:
    """Send a single chat message"""
    print_color(f"[INFO] Session {session_idx}, Message {msg_idx}: {message[:80]}...", 'blue')

    try:
        response = requests.post(
            f"{API_BASE_URL}/api/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": message}],
                "sessionId": session_id,
                "stream": False,
                "model": "gpt-4o"
            },
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            timeout=120  # 2 minute timeout per message
        )

        if response.status_code != 200:
            print_color(f"[ERROR] HTTP {response.status_code}: {response.text[:200]}", 'red')
            return {
                "success": False,
                "message": message,
                "error": f"HTTP {response.status_code}",
                "response": response.text[:500]
            }

        data = response.json()

        # Extract response content
        content = ""
        if "choices" in data and len(data["choices"]) > 0:
            content = data["choices"][0].get("message", {}).get("content", "")
        elif "message" in data:
            content = data.get("message", "")

        if not content:
            print_color(f"[WARNING] Empty response content", 'yellow')
            return {
                "success": False,
                "message": message,
                "error": "Empty response",
                "response": json.dumps(data)[:500]
            }

        # Extract MCP tools and diagram info
        mcp_tools = data.get("mcpToolsUsed", [])
        has_diagram = any(word in content.lower() for word in ["flowchart", "diagram", "chart", "graph"])

        content_length = len(content)
        print_color(f"[SUCCESS] Response received ({content_length} chars)", 'green')

        return {
            "success": True,
            "message": message,
            "response": content[:1000],  # Truncate long responses
            "response_length": content_length,
            "mcp_tools": mcp_tools,
            "has_diagram": has_diagram,
            "http_code": response.status_code
        }

    except requests.exceptions.Timeout:
        print_color(f"[ERROR] Request timeout", 'red')
        return {
            "success": False,
            "message": message,
            "error": "Timeout",
            "response": ""
        }
    except Exception as e:
        print_color(f"[ERROR] Exception: {e}", 'red')
        return {
            "success": False,
            "message": message,
            "error": str(e),
            "response": ""
        }

def run_chat_session(token: str, session_idx: int) -> Dict[str, Any]:
    """Run a complete chat session"""
    session_id = f"test-session-{int(time.time())}-{session_idx}"

    print_color(f"[INFO] Starting session {session_idx} (ID: {session_id})", 'blue')

    session_result = {
        "session_id": session_id,
        "session_index": session_idx,
        "messages": [],
        "success": True,
        "errors": []
    }

    # Send messages
    for msg_idx in range(MESSAGES_PER_SESSION):
        # Pick a question (cycle through them)
        question_idx = (session_idx * MESSAGES_PER_SESSION + msg_idx) % len(QUESTIONS)
        question = QUESTIONS[question_idx]

        # Send message
        msg_result = send_chat_message(token, session_id, question, session_idx, msg_idx)
        session_result["messages"].append(msg_result)

        # Check if message failed
        if not msg_result["success"]:
            session_result["success"] = False
            session_result["errors"].append(msg_result.get("error", "Unknown error"))

        # Small delay between messages
        time.sleep(1)

    return session_result

def main():
    """Main test execution"""
    print_color("=" * 60, 'blue')
    print_color("Chat API Stress Test", 'blue')
    print_color("=" * 60, 'blue')
    print_color(f"API Base URL: {API_BASE_URL}", 'blue')
    print_color(f"Sessions: {NUM_SESSIONS}", 'blue')
    print_color(f"Messages per session: {MESSAGES_PER_SESSION}", 'blue')
    print()

    # Initialize results
    results = {
        "test_start": datetime.now().isoformat(),
        "test_end": "",
        "configuration": {
            "api_base_url": API_BASE_URL,
            "num_sessions": NUM_SESSIONS,
            "messages_per_session": MESSAGES_PER_SESSION
        },
        "authentication": {
            "success": False,
            "token": ""
        },
        "sessions": [],
        "summary": {
            "total_sessions": 0,
            "successful_sessions": 0,
            "failed_sessions": 0,
            "total_messages": 0,
            "successful_messages": 0,
            "failed_messages": 0,
            "mcp_tools_invoked": [],
            "diagrams_requested": 0,
            "diagrams_rendered": 0,
            "errors": []
        }
    }

    # Authenticate
    token = authenticate()
    results["authentication"]["success"] = True
    results["authentication"]["token"] = token[:50] + "..."  # Truncate token

    # Run sessions concurrently
    print_color(f"\n[INFO] Starting {NUM_SESSIONS} concurrent chat sessions...", 'blue')
    start_time = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=NUM_SESSIONS) as executor:
        futures = []
        for i in range(NUM_SESSIONS):
            future = executor.submit(run_chat_session, token, i)
            futures.append(future)
            time.sleep(0.5)  # Small stagger

        # Wait for all sessions to complete
        print_color("[INFO] Waiting for all sessions to complete...", 'blue')
        for future in concurrent.futures.as_completed(futures):
            try:
                session_result = future.result()
                results["sessions"].append(session_result)
            except Exception as e:
                print_color(f"[ERROR] Session failed with exception: {e}", 'red')

    elapsed_time = time.time() - start_time
    print_color(f"\n[SUCCESS] All sessions completed in {elapsed_time:.1f} seconds", 'green')

    # Calculate summary statistics
    results["test_end"] = datetime.now().isoformat()
    results["summary"]["total_sessions"] = len(results["sessions"])
    results["summary"]["successful_sessions"] = sum(1 for s in results["sessions"] if s["success"])
    results["summary"]["failed_sessions"] = sum(1 for s in results["sessions"] if not s["success"])

    all_messages = [msg for session in results["sessions"] for msg in session["messages"]]
    results["summary"]["total_messages"] = len(all_messages)
    results["summary"]["successful_messages"] = sum(1 for m in all_messages if m["success"])
    results["summary"]["failed_messages"] = sum(1 for m in all_messages if not m["success"])

    # Collect MCP tools used
    mcp_tools = set()
    for msg in all_messages:
        if msg.get("mcp_tools"):
            mcp_tools.update(msg["mcp_tools"])
    results["summary"]["mcp_tools_invoked"] = sorted(list(mcp_tools))

    # Count diagram requests
    results["summary"]["diagrams_requested"] = sum(
        1 for m in all_messages
        if any(word in m["message"].lower() for word in ["draw", "create", "chart", "visualize", "diagram"])
    )
    results["summary"]["diagrams_rendered"] = sum(1 for m in all_messages if m.get("has_diagram"))

    # Collect unique errors
    all_errors = set()
    for session in results["sessions"]:
        all_errors.update(session["errors"])
    results["summary"]["errors"] = sorted(list(all_errors))

    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"{RESULTS_DIR}/stress_test_results_{timestamp}.json"

    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2)

    print_color(f"\n[SUCCESS] Results saved to {results_file}", 'green')

    # Display summary
    print("\n" + "=" * 60)
    print("TEST RESULTS SUMMARY")
    print("=" * 60)
    print(f"\nTotal Sessions: {results['summary']['total_sessions']}")
    print(f"Successful Sessions: {results['summary']['successful_sessions']}")
    print(f"Failed Sessions: {results['summary']['failed_sessions']}")
    print(f"\nTotal Messages: {results['summary']['total_messages']}")
    print(f"Successful Messages: {results['summary']['successful_messages']}")
    print(f"Failed Messages: {results['summary']['failed_messages']}")
    print(f"\nMCP Tools Invoked: {len(results['summary']['mcp_tools_invoked'])}")
    print(f"MCP Tools: {', '.join(results['summary']['mcp_tools_invoked']) if results['summary']['mcp_tools_invoked'] else 'None'}")
    print(f"\nDiagrams Requested: {results['summary']['diagrams_requested']}")
    print(f"Diagrams Rendered: {results['summary']['diagrams_rendered']}")
    print(f"\nErrors: {len(results['summary']['errors'])}")
    if results['summary']['errors']:
        print(f"Error Types: {', '.join(results['summary']['errors'])}")
    else:
        print("No errors!")
    print("\n" + "=" * 60)

    # Exit with appropriate code
    if results['summary']['failed_sessions'] > 0:
        print_color("\n[ERROR] Some sessions failed", 'red')
        sys.exit(1)
    else:
        print_color("\n[SUCCESS] All sessions completed successfully!", 'green')
        sys.exit(0)

if __name__ == "__main__":
    main()
