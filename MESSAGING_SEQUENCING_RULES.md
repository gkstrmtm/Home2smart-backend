# Messaging Sequencing Rules

## Lifecycle Event Triggers

| Event | DB State Changes | Who Gets Notified | Channels | Timing | Duplicate Prevention |
|-------|-----------------|-------------------|----------|--------|---------------------|
| **Offer Sent** | • Assignment: `state='offered'`, `offer_sent_at` set<br>• Job: `status='offer_sent'` (if was `'pending'`) | Tech | SMS + Email | Immediate | Check existing offer record (same job_id + pro_id) |
| **Accepted** | • Assignment: `state='accepted'`, `accepted_at` set<br>• Job: `status='accepted'` | Customer | Email | Immediate | Check if another pro already accepted (409 conflict) |
| **Declined** | • Assignment: `state='declined'`, `declined_at` set<br>• Job: `status='pending'` or `'pending_assign'` (reopen) | Dispatch/Admin | SMS or Email | Immediate | N/A (decline is idempotent by assignment state) |
| **Rescheduled** | • Order: `delivery_date`, `delivery_time` updated<br>• Job: `start_iso` updated, `status='scheduled'` | Customer + Tech (if assigned) | SMS + Email | Immediate | Check `last_email_sent_at` + `last_email_type='appointment_rescheduled'` within 2 minutes |
| **En Route / On My Way** | • Job: `status='en_route'`, `tech_en_route_at` set | Customer | SMS | Immediate | Check if `tech_en_route_at` already set |
| **Completed** | • Assignment: `state='completed'`, `completed_at` set<br>• Job: `status='completed'`, `completed_at` set | Customer | Email + SMS (optional) | Immediate | Check if `completed_at` already set on job |
| **Day-Before Reminder** | None (read-only) | Tech | SMS + Email | Scheduled (cron: 6 PM day before) | Check `h2s_sms_log` for same job_id + template within last 24h |
| **Morning-of Reminder** | None (read-only) | Tech | SMS + Email | Scheduled (cron: 7 AM day of) | Check `h2s_sms_log` for same job_id + template within last 12h |
| **2-Hour Reminder** | None (read-only) | Tech | SMS + Email | Scheduled (cron: 2h before start_iso) | Check `h2s_sms_log` for same job_id + template within last 2h |

## Job Status Flow

```
pending → offer_sent → accepted → en_route → completed
           ↓ (decline)
        pending (reopen)
```

## Open Offers Representation

- **Job Status:** `'pending'` or `'pending_assign'` = available for offers
- **Assignment State:** `'offered'` = active offer to specific tech
- **Multiple Offers:** Multiple assignment records with `state='offered'` can exist (one per tech)
- **Reopening:** When all offers declined, job status reverts to `'pending'` to allow new offers

