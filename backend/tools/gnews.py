"""GNews tool — news headline search for disaster corroboration.

Free tier: 100 requests/day. Used by agents to cross-check citizen
reports against real news coverage.
"""
from __future__ import annotations

import httpx
from langchain_core.tools import tool

from backend.core.config import settings

GNEWS_BASE = "https://gnews.io/api/v4/search"


@tool
def search_disaster_news(
    query: str,
    max_results: int = 5,
) -> dict:
    """Search recent news articles for disaster-related keywords.

    Use this to corroborate citizen reports against real news coverage.
    Example queries: "flood Bengaluru", "fire Koramangala", "earthquake Karnataka"

    Returns article titles, descriptions, URLs, and publication dates.
    """
    if not settings.keys.available("gnews"):
        return {
            "error": "GNews API key not configured",
            "available": False,
        }

    params = {
        "q": query,
        "lang": "en",
        "max": min(max_results, 10),
        "apikey": settings.keys.gnews,
        "sortby": "publishedAt",
    }

    try:
        resp = httpx.get(GNEWS_BASE, params=params, timeout=8.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as e:
        return {"error": f"GNews API error: {e}", "available": False}

    articles = data.get("articles", [])
    results = []
    for article in articles:
        results.append({
            "title": article.get("title", ""),
            "description": article.get("description", ""),
            "url": article.get("url", ""),
            "source": article.get("source", {}).get("name", ""),
            "published_at": article.get("publishedAt", ""),
        })

    return {
        "available": True,
        "query": query,
        "article_count": len(results),
        "articles": results,
    }
