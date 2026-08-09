"""Spending/budget math over the transactions log. No network calls.

Sign convention (see storage.load_transactions): negative amount = expense,
positive amount = income.
"""
from __future__ import annotations

import pandas as pd

from finance_tracker.config import INCOME_CATEGORY


def spending_by_category(transactions: pd.DataFrame, month: pd.Period | None = None) -> pd.Series:
    """Total spent per category (positive numbers) for one calendar month.

    `month` defaults to the most recent month present in the data. Income
    rows (category == INCOME_CATEGORY, or any positive amount) are excluded.
    """
    df = transactions.copy()
    df["month"] = df["date"].dt.to_period("M")
    if month is None:
        month = df["month"].max()
    month_df = df[(df["month"] == month) & (df["category"] != INCOME_CATEGORY) & (df["amount"] < 0)]
    return month_df.groupby("category")["amount"].sum().abs().sort_values(ascending=False)


def monthly_income(transactions: pd.DataFrame, month: pd.Period | None = None) -> float:
    """Total income for one calendar month: INCOME_CATEGORY rows plus any
    other positive-amount rows (e.g. a refund logged under its own category)."""
    df = transactions.copy()
    df["month"] = df["date"].dt.to_period("M")
    if month is None:
        month = df["month"].max()
    month_df = df[(df["month"] == month) & (df["amount"] > 0)]
    return float(month_df["amount"].sum())


def monthly_spending_total(transactions: pd.DataFrame, month: pd.Period | None = None) -> float:
    return float(spending_by_category(transactions, month=month).sum())


def budget_vs_actual(transactions: pd.DataFrame, budget: dict[str, float], month: pd.Period | None = None) -> pd.DataFrame:
    """Per-category budget target vs. actual spend, for one month."""
    actual = spending_by_category(transactions, month=month)
    categories = sorted(set(budget) | set(actual.index))
    rows = []
    for category in categories:
        target = float(budget.get(category, 0.0))
        spent = float(actual.get(category, 0.0))
        rows.append(
            {
                "category": category,
                "budget": target,
                "actual": spent,
                "remaining": target - spent,
                "over_budget": spent > target > 0,
            }
        )
    return pd.DataFrame(rows).sort_values("actual", ascending=False).reset_index(drop=True)


def spending_trend(transactions: pd.DataFrame, months: int = 6) -> pd.Series:
    """Total spend per month over the trailing `months` months present in the data."""
    df = transactions.copy()
    df["month"] = df["date"].dt.to_period("M")
    expenses = df[(df["category"] != INCOME_CATEGORY) & (df["amount"] < 0)]
    totals = expenses.groupby("month")["amount"].sum().abs().sort_index()
    return totals.tail(months)


def savings_rate(income: float, spending: float) -> float:
    """Fraction of income not spent. 0 if income is 0."""
    if income <= 0:
        return 0.0
    return (income - spending) / income


def net_worth(portfolio_market_value: float, cash_accounts: dict[str, float], liabilities: dict[str, float]) -> float:
    return portfolio_market_value + sum(cash_accounts.values()) - sum(liabilities.values())
