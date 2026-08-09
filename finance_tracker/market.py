"""Live market data via yfinance: prices, history, news, portfolio valuation.

Everything that touches the network lives here, kept separate from the pure
math in indicators.py so the math can be tested without network access.
"""
from __future__ import annotations

import logging

import pandas as pd
import yfinance as yf

from finance_tracker.config import PRICE_HISTORY_PERIOD

logger = logging.getLogger(__name__)


def get_history(ticker: str, period: str = PRICE_HISTORY_PERIOD) -> pd.DataFrame:
    """Daily OHLCV history for one ticker. Empty DataFrame on failure."""
    try:
        hist = yf.Ticker(ticker).history(period=period, auto_adjust=True)
    except Exception:
        logger.warning("Failed to fetch history for %s", ticker, exc_info=True)
        return pd.DataFrame()
    return hist


def get_histories(tickers: list[str], period: str = PRICE_HISTORY_PERIOD) -> dict[str, pd.DataFrame]:
    return {t: get_history(t, period=period) for t in tickers}


def get_current_prices(tickers: list[str]) -> pd.Series:
    """Latest close per ticker, as a Series indexed by ticker. Missing tickers
    are omitted (logged as a warning) rather than raising, so one bad symbol
    in holdings/watchlist doesn't take down the whole dashboard."""
    prices = {}
    for ticker in tickers:
        hist = get_history(ticker, period="5d")
        if hist.empty:
            logger.warning("No price data for %s", ticker)
            continue
        prices[ticker] = hist["Close"].iloc[-1]
    return pd.Series(prices, name="price")


def get_news(ticker: str, limit: int = 5) -> list[dict]:
    """Recent headlines for a ticker: list of {title, publisher, link, published}."""
    try:
        raw = yf.Ticker(ticker).news or []
    except Exception:
        logger.warning("Failed to fetch news for %s", ticker, exc_info=True)
        return []
    items = []
    for entry in raw[:limit]:
        content = entry.get("content", entry)  # yfinance has changed this shape across versions
        title = content.get("title") or entry.get("title")
        if not title:
            continue
        publisher = (content.get("provider") or {}).get("displayName") or content.get("publisher") or ""
        link = (content.get("canonicalUrl") or {}).get("url") or content.get("link") or ""
        published = content.get("pubDate") or entry.get("providerPublishTime") or ""
        items.append({"title": title, "publisher": publisher, "link": link, "published": published})
    return items


def portfolio_value(holdings: pd.DataFrame) -> pd.DataFrame:
    """Adds live price, market_value, gain_loss, gain_loss_pct to a holdings frame."""
    prices = get_current_prices(holdings["ticker"].unique().tolist())
    out = holdings.copy()
    out["price"] = out["ticker"].map(prices)
    out["market_value"] = out["price"] * out["shares"]
    out["cost_total"] = out["cost_basis"] * out["shares"]
    out["gain_loss"] = out["market_value"] - out["cost_total"]
    out["gain_loss_pct"] = (out["gain_loss"] / out["cost_total"]).replace([float("inf"), float("-inf")], float("nan"))
    return out
