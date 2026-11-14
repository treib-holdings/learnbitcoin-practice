"""The practice network's bots: treasury upkeep, faucet, pay-it-forward pot,
refills, health alerts, and a small HTTP API for the practice app's Worker.

Every key lives in a Bitcoin Core wallet on the node; this service only asks
Core to build and sign. Standard library only.
"""
