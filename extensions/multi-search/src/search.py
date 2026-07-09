"""Multi-engine search CLI entry point.

Usage:
    python src/search.py "query" --engines arxiv,duckduckgo
    python src/search.py "query" --engines arxiv --max-results 10
"""

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

# Force UTF-8 encoding for stdout/stderr to handle Unicode characters
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from engines import get_engine, list_engines
from http_client import set_proxy


def search_single(name: str, query: str, max_results: int) -> tuple[str, list[dict], str | None]:
    """Run a single engine search. Returns (engine_name, results, error_message)."""
    engine = get_engine(name)
    if not engine:
        return name, [], f"Unknown engine: {name}"
    try:
        results = engine.search(query, max_results=max_results)
        return name, results, None
    except Exception as e:
        return name, [], str(e)


def main():
    prog = os.path.basename(sys.argv[0]) or "search"
    parser = argparse.ArgumentParser(
        description="Multi-engine search tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            f"Available engines: {', '.join(list_engines())}\n"
            "Examples:\n"
            f'  {prog} "transformer attention" --engines arxiv\n'
            f'  {prog} "python httpx" --engines duckduckgo,github\n'
        ),
    )
    parser.add_argument("query", help="Search query")
    parser.add_argument(
        "--engines",
        default="arxiv,duckduckgo,github",
        help="Comma-separated engine names (default: arxiv,duckduckgo,github)",
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=5,
        help="Max results per engine (default: 5)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=15,
        help="Timeout per engine in seconds (default: 15)",
    )
    parser.add_argument(
        "--no-proxy",
        action="store_true",
        help="Disable proxy for all engines",
    )
    parser.add_argument(
        "--proxy",
        default=None,
        help="Proxy URL (default: http://127.0.0.1:7890)",
    )

    args = parser.parse_args()

    # Apply proxy settings before any search
    if args.no_proxy:
        set_proxy(None)
    elif args.proxy:
        set_proxy(args.proxy)

    engine_names = [n.strip() for n in args.engines.split(",") if n.strip()]
    all_results = []
    used = []
    failed = {}

    # Run engines concurrently using thread pool
    with ThreadPoolExecutor(max_workers=len(engine_names)) as executor:
        futures = {
            executor.submit(search_single, name, args.query, args.max_results): name
            for name in engine_names
        }

        for future in as_completed(futures):
            name = futures[future]
            try:
                _, results, error = future.result(timeout=args.timeout)
                if error:
                    failed[name] = error
                    print(f"[{name}] error: {error}", file=sys.stderr)
                else:
                    all_results.extend(results)
                    used.append(name)
            except Exception as e:
                failed[name] = str(e)
                print(f"[{name}] error: {e}", file=sys.stderr)

    output = {
        "query": args.query,
        "total_results": len(all_results),
        "engines_used": used,
        "engines_failed": failed,
        "results": all_results,
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
