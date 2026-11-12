"""认证契约检查的仓库级入口。"""

from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
result = subprocess.run(
    [sys.executable, "-X", "utf8", str(ROOT / "contracts/native-bootstrap/v1/verify_contract.py")],
    cwd=ROOT,
    check=False,
)
sys.exit(result.returncode)
