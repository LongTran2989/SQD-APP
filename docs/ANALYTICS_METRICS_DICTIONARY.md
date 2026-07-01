# Analytics Metrics Dictionary

This document outlines the core mathematical formulas, logic, and meanings of the various metrics calculated within the **Analytics & Workload** modules of the application. 

It serves as the source of truth for how the system evaluates Staff Performance, Template Efficiency, and general Workload capacity.

---

## 1. Staff Performance & Workload

### **Tasks Completed**
* **Logic:** The total count of tasks managed by a user that have reached a final completion state (`Closed`, `Rejected`, or `Terminated`).
* **Purpose:** Provides a concrete measure of throughput. Instead of just an average rating, this metric proves the volume of work delivered by the staff member over the selected period.

### **On-Time Rate**
* **Formula:** `(Tasks where completedAt <= deadline) / (Tasks Completed) * 100`
* **Logic:** 
  - Excludes tasks that do not have a defined deadline.
  - A task is considered "on time" if its `completedAt` timestamp is exactly on or before the `deadline` timestamp.
  - Expressed as a percentage.
* **Purpose:** Replaced the legacy "Rejection Rate" metric. Focuses on positive compliance and schedule adherence. A higher percentage reflects better time management.

### **Average Rating**
* **Formula:** `Sum(Task Star Ratings) / (Tasks Rated)`
* **Logic:** Averaged from the star ratings given by managers or reviewers when a task is closed. Tasks without a rating do not penalize the average.
* **Purpose:** Measures the qualitative output and quality of work of the staff member.

### **Average Efficiency (Staff)**
* **Formula:** `Average(Template Estimated Hours ÷ Actual Logged Hours)`
* **Logic:** 
  - Calculated on a per-task basis and then averaged across all of the user's completed tasks that have both an estimate and a time booking.
  - A value of `1.0` means exactly on-budget.
  - Values `> 1.0` mean the task took less time than estimated (Efficient / Green).
  - Values `< 1.0` mean the task took more time than estimated (Inefficient / Red).
* **Purpose:** Evaluates whether the staff member typically beats or exceeds the time budgets assigned to their tasks.

---

## 2. Template Efficiency

### **Average Actual**
* **Formula:** `Average(Total Hours Logged per Task)`
* **Logic:** The average of actual hours logged via the Time Booking system across all completed tasks for a specific template.
* **Purpose:** Shows the real-world time cost of executing a specific process.

### **Average Estimated**
* **Logic:** This is **not** an average of historical snapshots. This is the template's **canonical, live `estimatedHours` setting** pulled directly from the `Template` database record at query time.
* **Purpose:** Provides the current baseline target. If the template's estimate is updated by an admin today, all historical efficiency ratios for this template will automatically shift to reflect the new target.

### **Template Efficiency Ratio**
* **Formula:** `(Canonical Estimated Hours) ÷ (Average Actual Hours)`
* **Logic:** 
  - A value of `1.0` means the template is perfectly estimated.
  - Values `> 1.0` (Green) indicate staff are generally completing this template faster than the estimate. (The estimate might be too generous).
  - Values `< 1.0` (Red) indicate staff are generally taking longer than the estimate. (The estimate might be too tight, or the process is flawed).
* **Purpose:** Helps Directors and Admins tune their template estimates and identify systemic workflow bottlenecks.

### **Over-Budget Count & Top Reason**
* **Logic:**
  - **Count:** Number of tasks where `totalHours > (estimatedHours * 1.2)`.
  - **Top Reason:** The most frequently selected dropdown reason (e.g., `Wait time`, `Complex task`) when the 120% gate is triggered.
* **Purpose:** Provides qualitative context to *why* a template might have a poor efficiency ratio.

---

## 3. UI Status Badges & Colors

The UI relies heavily on visual color indicators for quick assessment. The thresholds are strictly defined:

* **Good / Positive (Green):**
  * Efficiency Ratio `≥ 1.0`
  * Using the design system token: `text-emerald-clear` or `bg-emerald-clear/10`
* **Warning / Negative (Red):**
  * Efficiency Ratio `< 1.0`
  * Using the design system token: `text-red-finding` or `bg-red-finding/10`

*(Note: The `1.2x` threshold is solely used to enforce the mandatory dropdown for an over-budget reason, while the visual badge strictly flips at exactly `1.0x`.)*
