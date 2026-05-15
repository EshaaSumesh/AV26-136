"""Social-signal tools for the Social-Media Intel agent.

Pulls posts from real free sources where possible:
  • Reddit JSON search  (r/bangalore, r/india, r/IndiaSpeaks, etc.) — no auth
  • RSS feeds           (Hindustan Times Bengaluru, The Hindu national)
  • GNews               (re-exposed under the social tool name for one-shot
                          corroboration; the actual GNews tool lives in gnews.py)

Twitter/X has been a paywalled API since 2023. To keep the demo self-sufficient
we offer a `generate_realistic_tweets` tool that asks the LLM to *synthesise*
plausible tweets matching the incident — clearly labeled `synthetic=True` so
the agent (and audience) can tell them apart from real signals.

All tools degrade gracefully when offline.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote_plus
from xml.etree import ElementTree as ET

import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

# ── Reddit ─────────────────────────────────────────────────────

REDDIT_SUBREDDITS = ["bangalore", "india", "IndiaSpeaks", "Karnataka"]
REDDIT_BASE = "https://www.reddit.com"
REDDIT_HEADERS = {
    # Reddit blocks default Python UAs; use a descriptive identifier.
    "User-Agent": "ResQRoute/1.0 (disaster-response demo)",
    "Accept": "application/json",
}


@tool
def search_reddit_posts(
    query: str,
    subreddits: Optional[list] = None,
    max_results: int = 8,
    hours_back: int = 24,
) -> dict:
    """Search Reddit for recent posts matching a disaster keyword.

    Reddit's public JSON endpoint requires no auth. We search a small set of
    India-relevant subreddits and return the most recent posts that match.

    Args:
        query: Search keyword(s) — e.g. "Bellandur flood", "fire Koramangala"
        subreddits: Subreddit names to search; defaults to bangalore/india/etc.
        max_results: Max posts to return.
        hours_back: Filter posts older than this many hours.

    Returns:
        {available, query, post_count, posts:[...]}
    """
    subs = subreddits or REDDIT_SUBREDDITS
    cutoff_ts = (datetime.now(timezone.utc).timestamp()) - hours_back * 3600

    posts: list[dict] = []
    seen_ids: set[str] = set()

    for sub in subs:
        if len(posts) >= max_results:
            break
        url = (
            f"{REDDIT_BASE}/r/{sub}/search.json"
            f"?q={quote_plus(query)}&restrict_sr=1&sort=new&limit=10&t=day"
        )
        try:
            resp = httpx.get(url, headers=REDDIT_HEADERS, timeout=6.0)
            if resp.status_code != 200:
                logger.debug("reddit %s -> %s", sub, resp.status_code)
                continue
            data = resp.json()
        except Exception as exc:
            logger.debug("reddit fetch failed for %s: %s", sub, exc)
            continue

        for child in data.get("data", {}).get("children", []):
            d = child.get("data") or {}
            pid = d.get("id")
            if not pid or pid in seen_ids:
                continue
            created_utc = float(d.get("created_utc") or 0.0)
            if created_utc < cutoff_ts:
                continue
            seen_ids.add(pid)
            posts.append({
                "platform": "reddit",
                "id": pid,
                "subreddit": d.get("subreddit", sub),
                "author": d.get("author", "[deleted]"),
                "title": d.get("title", ""),
                "text": (d.get("selftext", "") or "")[:600],
                "score": int(d.get("score", 0)),
                "num_comments": int(d.get("num_comments", 0)),
                "created_utc": created_utc,
                "created_at": datetime.fromtimestamp(
                    created_utc, tz=timezone.utc,
                ).isoformat() if created_utc else None,
                "url": f"{REDDIT_BASE}{d.get('permalink', '')}",
                "has_media": bool(d.get("preview")) or bool(d.get("url_overridden_by_dest", "").endswith((".jpg", ".png", ".mp4"))),
                "synthetic": False,
            })
            if len(posts) >= max_results:
                break

    posts.sort(key=lambda p: p["created_utc"], reverse=True)
    return {
        "available": True,
        "query": query,
        "post_count": len(posts),
        "posts": posts[:max_results],
    }


# ── RSS feeds ──────────────────────────────────────────────────

RSS_FEEDS = {
    "hindustan_times_bengaluru": "https://www.hindustantimes.com/feeds/rss/cities/bengaluru-news/rssfeed.xml",
    "the_hindu_national": "https://www.thehindu.com/news/national/karnataka/feeder/default.rss",
    "ndtv_india": "https://feeds.feedburner.com/ndtvnews-india-news",
    "deccan_herald_bengaluru": "https://www.deccanherald.com/rss/bengaluru.rss",
}

# Pre-compile a few HTML-strip patterns for RSS bodies.
_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(s: str) -> str:
    return _HTML_TAG_RE.sub("", s or "").strip()


@tool
def fetch_local_rss_feeds(
    keyword: Optional[str] = None,
    max_per_feed: int = 4,
) -> dict:
    """Fetch headlines from Bengaluru / India RSS feeds.

    Used for ground-truth corroboration: if multiple mainstream outlets are
    reporting on the same event, the agent should weight that signal heavily.

    Args:
        keyword: Optional filter; if set, only return items whose title or
                 description contains this token (case-insensitive).
        max_per_feed: Cap items returned per feed.
    """
    items: list[dict] = []
    for feed_id, url in RSS_FEEDS.items():
        try:
            resp = httpx.get(
                url, timeout=6.0,
                headers={"User-Agent": "ResQRoute/1.0"},
            )
            if resp.status_code != 200:
                continue
            root = ET.fromstring(resp.text)
        except Exception as exc:
            logger.debug("rss fetch failed (%s): %s", feed_id, exc)
            continue

        # Both RSS 2.0 and Atom; we handle the common `channel/item` shape.
        channel = root.find("channel") or root
        count = 0
        for it in channel.findall("item"):
            if count >= max_per_feed:
                break
            title = _strip_html((it.findtext("title") or "")).strip()
            descr = _strip_html((it.findtext("description") or "")).strip()
            link = (it.findtext("link") or "").strip()
            pub = (it.findtext("pubDate") or "").strip()

            if keyword:
                kw = keyword.lower()
                if kw not in title.lower() and kw not in descr.lower():
                    continue

            items.append({
                "platform": "rss",
                "feed": feed_id,
                "title": title[:200],
                "text": descr[:500],
                "url": link,
                "published_at": pub,
                "synthetic": False,
            })
            count += 1

    return {
        "available": True,
        "keyword": keyword,
        "item_count": len(items),
        "items": items,
    }


# ── Synthetic tweets (LLM-generated, clearly labeled) ───────────

@tool
def generate_realistic_tweets(
    incident_summary: str,
    location: str,
    count: int = 4,
) -> dict:
    """Generate plausible tweets that *might* be posted about this incident.

    Twitter/X requires a paid API key since 2023, so for demo reliability we
    synthesise plausible tweet content via a small LLM call. Each tweet is
    flagged `synthetic=True`. The Social-Media Intel agent should weight
    synthetic posts LOWER than corroborated real posts when computing the
    final legitimacy score — they exist purely to demonstrate the scoring
    pipeline when no real Twitter signal is reachable.

    Args:
        incident_summary: One-line description of the incident.
        location: City / locality name.
        count: How many tweets to synthesise (default 4, max 6).
    """
    from backend.agents.llm import get_llm

    n = max(1, min(int(count), 6))
    llm = get_llm()
    prompt = (
        "You are simulating Twitter/X posts for an emergency-response demo. "
        f"Generate {n} short, realistic tweets (each under 240 chars) that "
        "Bengaluru residents might post during this incident:\n\n"
        f"  Incident: {incident_summary}\n"
        f"  Location: {location}\n\n"
        "Mix the personas — concerned local, eyewitness, journalist, civic-minded "
        "complainer. Include realistic hashtags (#BengaluruRains, #BBMP, etc) and "
        "occasionally tag handles like @BBMP_Mahadevapura. Vary urgency and "
        "credibility deliberately so a downstream agent can score them.\n\n"
        "Return ONE tweet per line, no numbering, no markdown."
    )

    try:
        from langchain_core.messages import HumanMessage
        result = llm.invoke([HumanMessage(content=prompt)])
        text = result.content if hasattr(result, "content") else str(result)
    except Exception as exc:
        logger.warning("tweet synthesis failed: %s", exc)
        return {"available": False, "error": str(exc), "tweets": []}

    lines = [ln.strip(" -•").strip() for ln in str(text).splitlines() if ln.strip()]
    lines = [ln for ln in lines if len(ln) >= 20][:n]

    now = datetime.now(timezone.utc)
    handles = ["@blr_local", "@traffic_blr_user", "@BLRcommuter", "@kormangalan", "@whitefieldlife"]

    tweets = []
    for i, body in enumerate(lines):
        tweets.append({
            "platform": "twitter",
            "id": f"synthetic_{int(now.timestamp())}_{i}",
            "author": handles[i % len(handles)],
            "text": body[:280],
            "favorites": 0,
            "retweets": 0,
            "created_at": now.isoformat(),
            "url": None,
            "has_media": False,
            "synthetic": True,
        })

    return {
        "available": True,
        "tweet_count": len(tweets),
        "tweets": tweets,
        "note": (
            "Tweets are LLM-synthesised because the Twitter/X API is gated. "
            "Score them lower than independently-corroborated real signals."
        ),
    }
