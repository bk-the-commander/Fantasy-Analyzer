"""Loads your private financial data from data/ (gitignored).

Every loader raises a FileNotFoundError with a copy-pasteable fix if the file
is missing, pointing at the matching template in data/examples/.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import yaml

from finance_tracker.config import (
    HOLDINGS_PATH,
    PROFILE_PATH,
    TRANSACTIONS_PATH,
    WATCHLIST_PATH,
)


def _missing_file_error(path: Path) -> FileNotFoundError:
    example = path.parent / "examples" / path.name
    return FileNotFoundError(
        f"{path} not found. Copy the template and fill in your real data:\n"
        f"    cp {example} {path}"
    )


def load_profile(path: Path = PROFILE_PATH) -> dict:
    """Income, budget targets, cash accounts, liabilities."""
    if not path.exists():
        raise _missing_file_error(path)
    with open(path) as f:
        profile = yaml.safe_load(f) or {}
    profile.setdefault("income", {}).setdefault("monthly_net_salary", 0.0)
    profile.setdefault("budget", {})
    profile.setdefault("cash_accounts", {})
    profile.setdefault("liabilities", {})
    return profile


def load_holdings(path: Path = HOLDINGS_PATH) -> pd.DataFrame:
    """Stock/ETF positions: ticker, shares, cost_basis (per share), account."""
    if not path.exists():
        raise _missing_file_error(path)
    df = pd.read_csv(path)
    required = {"ticker", "shares", "cost_basis", "account"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{path} is missing required column(s): {sorted(missing)}")
    df["ticker"] = df["ticker"].str.upper().str.strip()
    return df


def load_transactions(path: Path = TRANSACTIONS_PATH) -> pd.DataFrame:
    """Spending/income log: date, category, description, amount.

    Sign convention: negative amount = money out (an expense), positive
    amount = money in (income/refund/deposit).
    """
    if not path.exists():
        raise _missing_file_error(path)
    df = pd.read_csv(path)
    required = {"date", "category", "description", "amount"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{path} is missing required column(s): {sorted(missing)}")
    df["date"] = pd.to_datetime(df["date"])
    df["amount"] = df["amount"].astype(float)
    return df


def load_watchlist(path: Path = WATCHLIST_PATH) -> pd.DataFrame:
    """Tickers you don't (yet) own but want screened for buy signals."""
    if not path.exists():
        raise _missing_file_error(path)
    df = pd.read_csv(path)
    if "ticker" not in df.columns:
        raise ValueError(f"{path} is missing required column: 'ticker'")
    df["ticker"] = df["ticker"].str.upper().str.strip()
    if "note" not in df.columns:
        df["note"] = ""
    return df
