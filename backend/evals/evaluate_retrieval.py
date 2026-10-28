"""Compare the unchanged keyword baseline and hybrid retrieval on fixed labels.

Run against a frozen Postgres copy, with its contest embeddings already indexed:
uv run python evals/evaluate_retrieval.py --cases evals/contest_retrieval.json --output /tmp/retrieval.json
"""
import argparse
import json
from pathlib import Path
from time import perf_counter

from sqlalchemy import func, select

from contest_detective.agent.rag.retrieval import HybridRetriever
from contest_detective.agent.rag.store import embeddings
from contest_detective.contest import service
from contest_detective.contest.models import Contest
from contest_detective.contest.schemas import ContestQuery
from contest_detective.framework.db import SessionLocal


def evaluate(cases):
    retriever = HybridRetriever()
    results = []
    for case in cases:
        result = {'query': case['query'], 'group': case['group'], 'relevant_ids': case['relevant_ids']}
        for name, search in [('keyword', service.query), ('hybrid', retriever.search)]:
            started = perf_counter()
            with SessionLocal() as session:
                items, total = search(session, ContestQuery(keyword=case['query'], page_size=5), attendable=False)
            correct = sum(item.id in case['relevant_ids'] for item in items)
            result[name] = {'top5': [{'id': item.id, 'name': item.name} for item in items],
                'total': total, 'correct': correct, 'hit_at_5': int(correct > 0), 'precision_at_5': correct / 5,
                'seconds': round(perf_counter() - started, 3)}
        results.append(result)
    metrics = {}
    for group in ['all', 'semantic', 'keyword_control']:
        selected = [result for result in results if group == 'all' or result['group'] == group]
        metrics[group] = {'queries': len(selected)}
        for name in ['keyword', 'hybrid']:
            metrics[group][name] = {
                'hit_at_5': sum(result[name]['hit_at_5'] for result in selected) / len(selected),
                'precision_at_5': sum(result[name]['correct'] for result in selected) / (5 * len(selected)),
            }
    return {'metrics': metrics, 'results': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    labels = json.loads(args.cases.read_text())
    with SessionLocal() as session:
        if session.get_bind().dialect.name != 'postgresql':
            parser.error('The comparison requires Postgres')
        count = session.scalar(select(func.count()).select_from(Contest))
        if count != labels['snapshot_contests']:
            parser.error('Contest count does not match the labeled snapshot')
        indexed = session.scalar(select(func.count()).select_from(embeddings))
        if indexed != count:
            parser.error('Finish indexing the complete snapshot before comparing retrieval')
    result = evaluate(labels['cases'])
    result.update({key: labels[key] for key in ['snapshot_date', 'snapshot_sha256', 'snapshot_contests', 'label_policy']})
    result['indexed_contests'] = indexed
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result['metrics'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
