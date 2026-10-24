"""公开赛事来源；聚合页面始终只提供转载断言。"""


def structured_sources():
    from contest_detective.server.research_pipeline.sources import devpost, hackertrip, waytoagi

    return [('hackertrip', hackertrip.fetch), ('waytoagi', waytoagi.fetch), ('devpost', devpost.fetch)]
