"""Source-regression pin: chat_sessions raw SQL must use snake_case column names.

Bug 1 (2026-05-18): admin_system_user_sessions used quoted camelCase identifiers
(`"userId"`, `"messageCount"`, `"createdAt"`, `"updatedAt"`) but the Prisma-mapped
DB columns are snake_case. Postgres threw `column "userId" does not exist`,
which surfaced as a broken admin UI session view.

The Python response-dict keys (lines 780-782, `"userId": r[2]` etc.) are JSON
response field names for API consumers and intentionally stay camelCase. ONLY
SQL identifiers must be snake_case.

This test pins the SQL strings inside the affected function so a future edit
can't reintroduce camelCase column references.
"""
import re
from pathlib import Path

SERVER_PY = Path(__file__).parent.parent / "src" / "admin_mcp_server" / "server.py"

CHAT_SESSIONS_CAMEL_IDENTIFIERS = [
    '"userId"',
    '"messageCount"',
    '"createdAt"',
    '"updatedAt"',
    '"isArchived"',
    '"lastModelUsed"',
    '"totalCost"',
]

def _extract_function_body(source: str, func_name: str) -> str:
    """Return the source lines from `async def <func_name>` until the next
    top-level `async def` / `def ` / `@` decorator at column 0."""
    lines = source.splitlines()
    in_func = False
    body: list[str] = []
    for line in lines:
        if not in_func:
            if re.match(rf"^async def {re.escape(func_name)}\b|^def {re.escape(func_name)}\b", line):
                in_func = True
                body.append(line)
            continue
        # End of function: next top-level def/async def/decorator
        if re.match(r"^(async def |def |@\w)", line):
            break
        body.append(line)
    return "\n".join(body)

def test_admin_system_user_sessions_sql_uses_snake_case():
    """The raw SQL inside admin_system_user_sessions must reference
    snake_case columns (user_id, message_count, created_at, updated_at) —
    not quoted camelCase. Response-dict keys (Python `"userId": r[2]`) are
    excluded from this check by extracting only the SQL string literals."""
    source = SERVER_PY.read_text()
    body = _extract_function_body(source, "admin_system_user_sessions")

    # Extract only triple-quoted SQL string blocks. Response-dict assignments
    # use single-line `"camelCase": ...` syntax and stay out of the SQL block.
    sql_strings = re.findall(r'"""(.*?)"""', body, flags=re.DOTALL)
    assert sql_strings, "admin_system_user_sessions must contain at least one SQL block"

    for sql in sql_strings:
        for camel_ident in CHAT_SESSIONS_CAMEL_IDENTIFIERS:
            assert camel_ident not in sql, (
                f"admin_system_user_sessions SQL contains forbidden quoted-camelCase "
                f"identifier {camel_ident!r}. Postgres column is snake_case — strip the "
                f"quotes and rename. SQL block:\n{sql[:200]}..."
            )

def test_admin_system_user_sessions_sql_uses_required_snake_case_columns():
    """The SQL must actually reference the snake_case columns we expect.
    Catches a future regression that accidentally drops the SELECT clause."""
    source = SERVER_PY.read_text()
    body = _extract_function_body(source, "admin_system_user_sessions")
    sql_blocks = re.findall(r'"""(.*?)"""', body, flags=re.DOTALL)
    combined_sql = "\n".join(sql_blocks)

    required = ["user_id", "message_count", "created_at", "updated_at"]
    for col in required:
        assert col in combined_sql, (
            f"admin_system_user_sessions SQL must reference snake_case column "
            f"{col!r} (missing after rename)."
        )
