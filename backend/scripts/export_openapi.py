"""把后端的 OpenAPI 描述导出到 ``backend/openapi.json``。

前端从这份文件生成接口类型，生成物和它一起提交。改了路由或响应模型之后，
在 ``frontend`` 里跑 ``npm run generate:api``，它会先调用本脚本再生成前端代码。
"""

import json
from pathlib import Path

from contest_detective.web.bootstrap.app import app

OUTPUT = Path(__file__).resolve().parents[1] / "openapi.json"


def main() -> None:
    OUTPUT.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
