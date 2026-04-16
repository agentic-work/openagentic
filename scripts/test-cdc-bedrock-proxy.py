# Proprietary and confidential. Unauthorized copying prohibited.

"""
CDC Bedrock Proxy Test Script (Python)
======================================

This script tests AWS Bedrock connectivity via the CDC proxy endpoint
(bedrock-dev.cdc.gov) with SSL certificate validation.

REQUIREMENTS:
  - Must be run from WITHIN the CDC network (AKS cluster or VPN)
  - AWS credentials must be configured (env vars or IAM role)
  - Python 3.8+ with boto3 installed
  - The bedrock-dev.cdc.gov endpoint must be accessible

USAGE:
  python test-cdc-bedrock-proxy.py

ENVIRONMENT VARIABLES:
  AWS_ACCESS_KEY_ID     - AWS access key (required if no IAM role)
  AWS_SECRET_ACCESS_KEY - AWS secret key (required if no IAM role)
  AWS_REGION            - AWS region (default: us-east-1)
  CDC_BEDROCK_ENDPOINT  - CDC proxy URL (default: https://bedrock-dev.cdc.gov)
"""

import os
import sys
import json
import socket
import ssl
import urllib.request
from datetime import datetime

# Check for boto3
try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError, EndpointConnectionError
except ImportError:
    print("ERROR: boto3 is required. Install with: pip install boto3")
    sys.exit(1)


# Configuration
CDC_BEDROCK_ENDPOINT = os.getenv("CDC_BEDROCK_ENDPOINT", "https://bedrock-dev.cdc.gov")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Claude 4.6 models (inference profile IDs)
MODELS = [
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "us.anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-opus-4-6-v1",
]


def print_header(title: str):
    """Print a section header."""
    print(f"\n{'=' * 60}")
    print(f"{title}")
    print(f"{'=' * 60}")


def print_test(name: str):
    """Print a test name."""
    print(f"\nTest: {name}")
    print("-" * 40)


def print_pass(message: str):
    """Print a passing test result."""
    print(f"  \033[92mPASS\033[0m: {message}")


def print_fail(message: str):
    """Print a failing test result."""
    print(f"  \033[91mFAIL\033[0m: {message}")


def print_warn(message: str):
    """Print a warning message."""
    print(f"  \033[93mWARN\033[0m: {message}")


def print_info(message: str):
    """Print an info message."""
    print(f"  INFO: {message}")


def test_dns_resolution(hostname: str) -> bool:
    """Test DNS resolution of the endpoint."""
    print_test("DNS Resolution")
    try:
        ip = socket.gethostbyname(hostname)
        print_pass(f"{hostname} resolves to {ip}")
        return True
    except socket.gaierror as e:
        print_fail(f"Cannot resolve {hostname}: {e}")
        print_info("This script must be run from within the CDC network (AKS cluster or VPN)")
        return False


def test_ssl_certificate(hostname: str, port: int = 443) -> bool:
    """Test SSL certificate validation."""
    print_test("SSL Certificate Validation")

    try:
        # Create SSL context with certificate verification
        context = ssl.create_default_context()

        with socket.create_connection((hostname, port), timeout=10) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()

                # Extract certificate info
                subject = dict(x[0] for x in cert.get('subject', []))
                issuer = dict(x[0] for x in cert.get('issuer', []))
                not_before = cert.get('notBefore', 'N/A')
                not_after = cert.get('notAfter', 'N/A')

                print_pass("SSL certificate is valid and trusted")
                print_info(f"Subject CN: {subject.get('commonName', 'N/A')}")
                print_info(f"Issuer CN: {issuer.get('commonName', 'N/A')}")
                print_info(f"Valid from: {not_before}")
                print_info(f"Valid until: {not_after}")

                return True

    except ssl.SSLCertVerificationError as e:
        print_warn(f"SSL certificate verification failed: {e}")
        print_info("This may be expected if using CDC's internal CA.")
        print_info("Ensure CDC root CA is trusted in the container/pod.")
        return False
    except Exception as e:
        print_fail(f"SSL connection failed: {e}")
        return False


def test_https_connectivity(url: str) -> bool:
    """Test HTTPS connectivity to the endpoint."""
    print_test("HTTPS Connectivity")

    try:
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=10) as response:
            print_pass(f"Endpoint reachable (HTTP {response.status})")
            return True
    except urllib.error.HTTPError as e:
        if e.code in [401, 403]:
            print_pass(f"Endpoint reachable (HTTP {e.code} - auth required)")
            return True
        else:
            print_warn(f"Unexpected HTTP status: {e.code}")
            return False
    except urllib.error.URLError as e:
        print_fail(f"Cannot connect to endpoint: {e}")
        return False
    except Exception as e:
        print_fail(f"Connection failed: {e}")
        return False


def test_bedrock_invocation(endpoint: str, region: str, model_id: str) -> bool:
    """Test AWS Bedrock model invocation via the proxy."""
    print(f"\n  Testing model: {model_id}")

    try:
        # Configure boto3 to use custom endpoint
        config = Config(
            region_name=region,
            retries={'max_attempts': 1}
        )

        # Create Bedrock Runtime client with custom endpoint
        client = boto3.client(
            'bedrock-runtime',
            region_name=region,
            endpoint_url=endpoint,
            config=config
        )

        # Create request payload
        payload = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 50,
            "messages": [
                {
                    "role": "user",
                    "content": "Say 'Hello from CDC Bedrock proxy test' in exactly those words."
                }
            ]
        }

        # Invoke model
        response = client.invoke_model(
            modelId=model_id,
            contentType='application/json',
            accept='application/json',
            body=json.dumps(payload)
        )

        # Parse response
        response_body = json.loads(response['body'].read())

        if 'content' in response_body and len(response_body['content']) > 0:
            text = response_body['content'][0].get('text', '')
            print_pass(f"Model responded successfully")
            print_info(f"Response: {text[:100]}...")
            return True
        else:
            print_warn("Unexpected response format")
            print_info(f"Response: {json.dumps(response_body)[:200]}")
            return False

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        print_fail(f"Bedrock API error: {error_code} - {error_message}")
        return False
    except EndpointConnectionError as e:
        print_fail(f"Cannot connect to Bedrock endpoint: {e}")
        return False
    except Exception as e:
        print_fail(f"Model invocation failed: {e}")
        return False


def main():
    """Main test function."""
    print_header("CDC Bedrock Proxy Test")
    print(f"\nEndpoint: {CDC_BEDROCK_ENDPOINT}")
    print(f"Region:   {AWS_REGION}")
    print(f"Time:     {datetime.now().isoformat()}")

    # Check for AWS credentials
    if not os.getenv("AWS_ACCESS_KEY_ID") or not os.getenv("AWS_SECRET_ACCESS_KEY"):
        print_warn("AWS credentials not found in environment variables")
        print_info("Will attempt to use IAM role or instance profile")

    # Extract hostname from endpoint URL
    hostname = CDC_BEDROCK_ENDPOINT.replace("https://", "").replace("http://", "").split("/")[0]

    # Run tests
    results = []

    # Test 1: DNS Resolution
    results.append(("DNS Resolution", test_dns_resolution(hostname)))

    # If DNS fails, we can't continue
    if not results[-1][1]:
        print_header("Test Summary")
        print("\n\033[91mFAILED\033[0m: Cannot reach CDC network")
        print("This script must be run from within the CDC network.")
        sys.exit(1)

    # Test 2: SSL Certificate
    results.append(("SSL Certificate", test_ssl_certificate(hostname)))

    # Test 3: HTTPS Connectivity
    results.append(("HTTPS Connectivity", test_https_connectivity(CDC_BEDROCK_ENDPOINT)))

    # Test 4: Bedrock Model Invocation
    print_test("AWS Bedrock Model Invocation")
    model_results = []
    for model_id in MODELS:
        model_results.append(test_bedrock_invocation(CDC_BEDROCK_ENDPOINT, AWS_REGION, model_id))

    results.append(("Bedrock Invocation", any(model_results)))

    # Print summary
    print_header("Test Summary")
    print()
    for test_name, passed in results:
        status = "\033[92mPASS\033[0m" if passed else "\033[91mFAIL\033[0m"
        print(f"  [{status}] {test_name}")

    print()
    all_passed = all(r[1] for r in results)
    if all_passed:
        print("\033[92mAll tests passed!\033[0m")
        print("\nTo configure OpenAgentic to use this proxy, set:")
        print(f"  AWS_BEDROCK_ENDPOINT={CDC_BEDROCK_ENDPOINT}")
        print("\nIn Helm values:")
        print("  aws:")
        print("    bedrock:")
        print("      enabled: true")
        print(f"      endpoint: {CDC_BEDROCK_ENDPOINT}")
    else:
        print("\033[91mSome tests failed.\033[0m")
        print("Please check the output above for details.")
        sys.exit(1)


if __name__ == "__main__":
    main()
