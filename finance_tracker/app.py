"""Streamlit dashboard tying together budget, portfolio, and signal screening.

Run with:
    streamlit run finance_tracker/app.py
"""
from __future__ import annotations

import pandas as pd
import streamlit as st

from finance_tracker.budget import (
    budget_vs_actual,
    monthly_income,
    monthly_spending_total,
    net_worth,
    savings_rate,
    spending_by_category,
    spending_trend,
)
from finance_tracker.market import get_histories, get_news, portfolio_value
from finance_tracker.signals import screen_tickers
from finance_tracker.storage import load_holdings, load_profile, load_transactions, load_watchlist

st.set_page_config(page_title="Finance Tracker", layout="wide")


@st.cache_data(ttl=300)
def _load_data():
    profile = load_profile()
    holdings = load_holdings()
    transactions = load_transactions()
    try:
        watchlist = load_watchlist()
    except FileNotFoundError:
        watchlist = pd.DataFrame(columns=["ticker", "note"])
    return profile, holdings, transactions, watchlist


@st.cache_data(ttl=300)
def _load_portfolio(holdings: pd.DataFrame) -> pd.DataFrame:
    return portfolio_value(holdings)


@st.cache_data(ttl=300)
def _load_screen(tickers: tuple[str, ...]) -> pd.DataFrame:
    histories = get_histories(list(tickers))
    return screen_tickers(histories)


try:
    profile, holdings, transactions, watchlist = _load_data()
except FileNotFoundError as e:
    st.error(str(e))
    st.info("See README 'Finance Tracker' -> Setup for how to populate data/ from the templates in data/examples/.")
    st.stop()

st.title("Finance Tracker")
st.caption(
    "Personal budget + portfolio dashboard. Buy/watch signals are plain technical "
    "indicators (RSI, moving averages, MACD) -- not investment advice."
)

tab_overview, tab_spending, tab_portfolio, tab_signals = st.tabs(
    ["Overview", "Spending", "Portfolio", "Buy Signals"]
)

priced_holdings = _load_portfolio(holdings)
port_value = priced_holdings["market_value"].sum(skipna=True)

with tab_overview:
    latest_month = transactions["date"].dt.to_period("M").max()
    income = monthly_income(transactions, month=latest_month) or profile["income"]["monthly_net_salary"]
    spending = monthly_spending_total(transactions, month=latest_month)
    rate = savings_rate(income, spending)
    worth = net_worth(port_value, profile["cash_accounts"], profile["liabilities"])

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Net worth", f"${worth:,.0f}")
    col2.metric("Portfolio value", f"${port_value:,.0f}")
    col3.metric(f"Spending ({latest_month})", f"${spending:,.0f}")
    col4.metric("Savings rate", f"{rate:.0%}")

    col5, col6 = st.columns(2)
    with col5:
        st.subheader("Cash accounts")
        st.dataframe(pd.Series(profile["cash_accounts"], name="balance").to_frame(), use_container_width=True)
    with col6:
        st.subheader("Liabilities")
        st.dataframe(pd.Series(profile["liabilities"], name="balance").to_frame(), use_container_width=True)

with tab_spending:
    latest_month = transactions["date"].dt.to_period("M").max()
    months_available = sorted(transactions["date"].dt.to_period("M").unique())
    selected_month = st.selectbox("Month", options=months_available[::-1], format_func=str)

    bva = budget_vs_actual(transactions, profile["budget"], month=selected_month)
    st.subheader(f"Budget vs. actual -- {selected_month}")
    st.bar_chart(bva.set_index("category")[["budget", "actual"]])
    over = bva[bva["over_budget"]]
    if not over.empty:
        st.warning("Over budget: " + ", ".join(f"{r.category} (+${-r.remaining:,.0f})" for r in over.itertuples()))
    st.dataframe(bva, use_container_width=True, hide_index=True)

    st.subheader("Spending by category (selected month)")
    cat = spending_by_category(transactions, month=selected_month)
    st.bar_chart(cat)

    st.subheader("Spending trend")
    trend = spending_trend(transactions, months=12)
    st.line_chart(trend)

with tab_portfolio:
    st.subheader("Holdings")
    display_cols = ["ticker", "account", "shares", "cost_basis", "price", "market_value", "gain_loss", "gain_loss_pct"]
    view = priced_holdings[display_cols].copy()
    view["gain_loss_pct"] = view["gain_loss_pct"].map(lambda x: f"{x:.1%}" if pd.notna(x) else "n/a")
    st.dataframe(view, use_container_width=True, hide_index=True)

    st.subheader("Allocation by ticker")
    alloc = priced_holdings.groupby("ticker")["market_value"].sum().sort_values(ascending=False)
    st.bar_chart(alloc)

    total_cost = priced_holdings["cost_total"].sum(skipna=True)
    total_gain = priced_holdings["gain_loss"].sum(skipna=True)
    st.metric("Total unrealized gain/loss", f"${total_gain:,.0f}", delta=f"{(total_gain / total_cost):.1%}" if total_cost else None)

with tab_signals:
    st.subheader("Buy-signal screener")
    all_tickers = tuple(sorted(set(holdings["ticker"]) | set(watchlist["ticker"])))
    if not all_tickers:
        st.info("Add tickers to data/holdings.csv or data/watchlist.csv to screen them.")
    else:
        screened = _load_screen(all_tickers)
        st.dataframe(
            screened.assign(flags=screened["flags"].map(lambda fs: "; ".join(fs) if fs else "")),
            use_container_width=True,
            hide_index=True,
        )

        st.subheader("News")
        pick = st.selectbox("Ticker", options=all_tickers)
        for item in get_news(pick):
            st.markdown(f"**[{item['title']}]({item['link']})** -- {item['publisher']}")
