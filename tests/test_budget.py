"""Unit tests for budget math against hand-built transaction logs. No network."""
import pandas as pd
import pytest

from finance_tracker.budget import (
    budget_vs_actual,
    monthly_income,
    monthly_spending_total,
    net_worth,
    savings_rate,
    spending_by_category,
    spending_trend,
)


def _transactions():
    return pd.DataFrame(
        [
            {"date": "2026-07-01", "category": "Income", "description": "Paycheck", "amount": 3000.0},
            {"date": "2026-07-02", "category": "Rent", "description": "July rent", "amount": -1500.0},
            {"date": "2026-07-05", "category": "Groceries", "description": "Store", "amount": -200.0},
            {"date": "2026-07-10", "category": "Groceries", "description": "Store", "amount": -50.0},
            {"date": "2026-06-01", "category": "Income", "description": "Paycheck", "amount": 3000.0},
            {"date": "2026-06-02", "category": "Rent", "description": "June rent", "amount": -1500.0},
            {"date": "2026-06-05", "category": "Groceries", "description": "Store", "amount": -300.0},
        ]
    ).assign(date=lambda d: pd.to_datetime(d["date"]))


def test_spending_by_category_excludes_income_and_defaults_to_latest_month():
    result = spending_by_category(_transactions())
    assert result.to_dict() == {"Rent": 1500.0, "Groceries": 250.0}


def test_spending_by_category_specific_month():
    result = spending_by_category(_transactions(), month=pd.Period("2026-06"))
    assert result.to_dict() == {"Rent": 1500.0, "Groceries": 300.0}


def test_monthly_income_and_spending_total():
    txns = _transactions()
    assert monthly_income(txns, month=pd.Period("2026-07")) == pytest.approx(3000.0)
    assert monthly_spending_total(txns, month=pd.Period("2026-07")) == pytest.approx(1750.0)


def test_budget_vs_actual_flags_over_budget():
    txns = _transactions()
    budget = {"Rent": 1500.0, "Groceries": 200.0}
    result = budget_vs_actual(txns, budget, month=pd.Period("2026-07"))
    groceries = result[result["category"] == "Groceries"].iloc[0]
    rent = result[result["category"] == "Rent"].iloc[0]
    assert groceries["over_budget"]
    assert groceries["remaining"] == pytest.approx(-50.0)
    assert not rent["over_budget"]
    assert rent["remaining"] == pytest.approx(0.0)


def test_budget_vs_actual_includes_category_with_no_spend():
    txns = _transactions()
    budget = {"Rent": 1500.0, "Entertainment": 100.0}
    result = budget_vs_actual(txns, budget, month=pd.Period("2026-07"))
    ent = result[result["category"] == "Entertainment"].iloc[0]
    assert ent["actual"] == 0.0
    assert not ent["over_budget"]


def test_spending_trend_orders_by_month():
    trend = spending_trend(_transactions(), months=12)
    assert list(trend.index.astype(str)) == ["2026-06", "2026-07"]
    assert trend.loc[pd.Period("2026-06")] == pytest.approx(1800.0)
    assert trend.loc[pd.Period("2026-07")] == pytest.approx(1750.0)


def test_savings_rate():
    assert savings_rate(income=1000, spending=750) == pytest.approx(0.25)
    assert savings_rate(income=0, spending=100) == 0.0


def test_net_worth():
    result = net_worth(
        portfolio_market_value=10000,
        cash_accounts={"Checking": 2000, "Savings": 5000},
        liabilities={"Credit Card": 1000},
    )
    assert result == pytest.approx(16000)
