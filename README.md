## Disclaimer

> [!WARNING]
> **For Educational Purposes Only.**
> This project is designed solely for educational, research, and personal validation purposes. It is **not** an official application of Indian Railways or IRCTC.
>
> This tool functions by mimicking standard browser requests and uses unofficial endpoints parsed directly from web sessions. It does **not** use official B2B booking APIs or GDS platforms.
>
> Excessive requests or scraping can lead to temporary or permanent IP blocks from the official servers. The author is not responsible for any misuse, rate limiting, or tracking resulting from the utilization of this repository. Always use responsibly and adhere to IRCTC's terms of service.

---

# Smart Rail Seat Finder

A smart ticket search engine and finder for Indian Railways (IRCTC) that maximizes the chance of finding **confirmed and available seats** by executing advanced ticketing strategies: Direct bookings, Boarding Point Changes, Split Journeys on the same train, and Connecting Train routing (via major hubs).

Includes a clean, state-of-the-art **glassmorphic Web UI** as well as a fast, fully-featured **Command Line Interface (CLI)**.

---

## Key Features

* **Direct & Boarding Point Shifts:** Automatically searches for seats from the boarding station, as well as up to 5 stations backward (boarding change strategy) to tap into larger pool quotas.
* **Split Journeys (Same Train):** Evaluates split tickets on the same train via major intermediate stations (e.g., Ticket 1: `A → B` and Ticket 2: `B → C` on the same train).
* **Connecting Journeys (2 & 3 Trains):** Finds connecting trains via major junctions (2-train connections) and major hubs (3-train connections) with intelligent layover time checks (ensuring connecting trains leave after arrivals with a reasonable buffer).
* **Smart Filtering:** 
  * Automatically filters out all **Special Trains (SPL)** (due to low track priority and heavy delays).
  * Excludes all **Waiting List (WL)** tickets (shows only 100% confirmed, `AVAILABLE`, or `RAC` tickets).
* **Performance Optimized:** Automatically runs in batches and terminates search phases early if a direct or boarding change seat is found to minimize API calls.

---

## Getting Started

### Prerequisites

* Node.js (v18+ recommended)
* `npm` package manager

### Installation

1. Navigate to the project directory:
   ```bash
   cd confirm-train-ticket-finder
   ```
2. Install the Express server dependencies:
   ```bash
   npm install
   ```

---

## How to Use

### 1. Web UI Mode (Recommended)
Simply start the server without any arguments. It will boot an Express backend on port `3005` and automatically launch the UI in your default web browser:
```bash
node server.js
```
Open [http://localhost:3005](http://localhost:3005) if it does not open automatically.

### 2. CLI Mode
You can run search queries directly inside your terminal by providing the boarding station, destination, date, and optional quota:
```bash
node server.js <Boarding_Station> <Destination_Station> <Date_YYYYMMDD> <Quota_Code>
```

#### Examples:
* Search General Quota (GN):
  ```bash
  node server.js MFP ST 20260625 GN
  ```
* Search Tatkal Quota (TQ):
  ```bash
  node server.js MFP ANVT 20260625 TQ
  ```

---

