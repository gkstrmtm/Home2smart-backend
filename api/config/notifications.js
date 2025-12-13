// Notification Templates & Configuration
// Centralizes all SMS and Email templates with proper opt-out language

export const SMS_TEMPLATES = {
  // BOOKING FLOW
  payment_confirmed: {
    message: "Hi {firstName}, thanks for your payment of ${amount}! Log in at home2smart.com/bundles to schedule your {service} installation. Reply STOP to opt out.",
    requiresConsent: true
  },
  
  appointment_scheduled: {
    message: "Hi {firstName}, your {service} appointment is confirmed for {date} at {time}. Location: {city}, {state}. Questions? Call (864) 528-1475. Reply STOP to opt out.",
    requiresConsent: true
  },
  
  appointment_reminder_24h: {
    message: "Reminder: Your {service} appointment with Home2Smart is tomorrow at {time}. Address: {address}. See you then! Reply STOP to opt out.",
    requiresConsent: true
  },
  
  appointment_reminder_2h: {
    message: "We're on our way! Your tech {proName} will arrive at {time} for your {service} appointment. Reply STOP to opt out.",
    requiresConsent: true
  },
  
  // PRO NOTIFICATIONS
  pro_job_assigned: {
    message: "New job assigned! {service} for {customerName} on {date} at {time}. Address: {address}, {city}. View details in portal. Reply STOP to opt out.",
    requiresConsent: false // Business communication
  },
  
  pro_job_reminder: {
    message: "Job reminder: {service} appointment today at {time}. Customer: {customerName}. Address: {address}. Phone: {customerPhone}. Reply STOP to opt out.",
    requiresConsent: false
  },
  
  // QUOTE FOLLOW-UP
  quote_received: {
    message: "Thanks for your quote request! We'll contact you within 1 hour at {phone}. - Home2Smart. Reply STOP to opt out.",
    requiresConsent: true
  },
  
  // COMPLETION & FOLLOW-UP
  job_completed_thank_you: {
    message: "Thank you for choosing Home2Smart! Please rate your experience: {reviewUrl}. Reply STOP to opt out.",
    requiresConsent: true
  },
  
  // MANAGEMENT ALERTS (Internal - no opt-out required)
  mgmt_new_booking: {
    message: "🔔 NEW BOOKING: {service} for {customerName} on {date} at {time}. Order #{orderNumber}. Total: ${amount}. Location: {city}, {state}.",
    requiresConsent: false
  },
  
  mgmt_high_value_order: {
    message: "💰 HIGH VALUE ORDER: ${amount} - {service} for {customerName}. Order #{orderNumber}. Payment confirmed.",
    requiresConsent: false
  },
  
  mgmt_pro_assignment_failed: {
    message: "⚠️ ASSIGNMENT FAILED: Job #{jobId} for {service} on {date} at {time}. No available pros. Manual assignment needed.",
    requiresConsent: false
  },
  
  mgmt_quote_request: {
    message: "📋 NEW QUOTE: {customerName} ({phone}) - {service}. Details: {details}",
    requiresConsent: false
  },
  
  mgmt_pro_declined: {
    message: "⚠️ TECH DECLINED: {pro_name} declined job #{job_id} for {customer_name} ({service}). Location: {location}. Scheduled: {scheduled}. Job reopened for reassignment.",
    requiresConsent: false
  }
};

export const EMAIL_TEMPLATES = {
  payment_confirmation: {
    subject: "Payment Confirmed - {service} Installation | Home2Smart",
    fromEmail: "contact@home2smart.com",
    fromName: "Home2Smart"
  },
  
  booking_confirmation: {
    subject: "Appointment Confirmed - {service} on {date} | Home2Smart",
    fromEmail: "contact@home2smart.com",
    fromName: "Home2Smart"
  },
  
  quote_received: {
    subject: "Quote Request Received - We'll Contact You Soon | Home2Smart",
    fromEmail: "contact@home2smart.com",
    fromName: "Home2Smart"
  },
  
  pro_job_assigned: {
    subject: "New Job Assignment - {service} on {date}",
    fromEmail: "dispatch@home2smart.com",
    fromName: "H2S Dispatch"
  },
  
  job_completion_receipt: {
    subject: "Service Complete - Thank You! | Home2Smart",
    fromEmail: "contact@home2smart.com",
    fromName: "Home2Smart"
  },
  
  // MANAGEMENT ALERTS
  mgmt_new_booking: {
    subject: "🔔 New Booking: {service} - Order #{orderNumber}",
    fromEmail: "dispatch@home2smart.com",
    fromName: "H2S Dispatch Alerts"
  },
  
  mgmt_high_value_order: {
    subject: "💰 High Value Order: ${amount} - {service}",
    fromEmail: "dispatch@home2smart.com",
    fromName: "H2S Dispatch Alerts"
  },
  
  mgmt_pro_assignment_failed: {
    subject: "⚠️ Pro Assignment Failed - Job #{jobId}",
    fromEmail: "dispatch@home2smart.com",
    fromName: "H2S Dispatch Alerts"
  },
  
  mgmt_quote_request: {
    subject: "📋 New Quote Request: {service} from {customerName}",
    fromEmail: "dispatch@home2smart.com",
    fromName: "H2S Dispatch Alerts",
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
  <div style="background: #0a2a5a; color: white; padding: 20px; text-align: center;">
    <h1 style="margin: 0;">🎯 New Custom Quote Request</h1>
  </div>
  
  <div style="background: white; padding: 30px; margin-top: 20px; border-radius: 8px;">
    <h2 style="color: #0a2a5a; margin-top: 0;">Quote Request</h2>
    
    <div style="background: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <h3 style="margin: 0 0 10px 0; color: #1976d2;">Customer Information</h3>
      <p style="margin: 5px 0;"><strong>Name:</strong> {customerName}</p>
      <p style="margin: 5px 0;"><strong>Email:</strong> <a href="mailto:{email}">{email}</a></p>
      <p style="margin: 5px 0;"><strong>Phone:</strong> <a href="tel:{phone}">{phone}</a></p>
    </div>
    
    <div style="background: #fff3e0; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <h3 style="margin: 0 0 10px 0; color: #f57c00;">Package Type</h3>
      <p style="margin: 0; font-weight: bold;">{service}</p>
    </div>
    
    <div style="background: #f1f8e9; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <h3 style="margin: 0 0 10px 0; color: #689f38;">Project Details</h3>
      <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">{details}</pre>
    </div>
    
    <div style="background: #fce4ec; padding: 15px; border-radius: 6px; margin: 20px 0;">
      <h3 style="margin: 0 0 10px 0; color: #c2185b;">⏰ Action Required</h3>
      <p style="margin: 0;"><strong>Contact customer within 1 hour</strong></p>
    </div>
    
    <div style="text-align: center; margin-top: 30px;">
      <a href="tel:{phone}" style="display: inline-block; background: #22C96F; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">📞 Call Now</a>
    </div>
  </div>
</div>`
  }
};

// SMS Compliance Settings
export const SMS_COMPLIANCE = {
  optOutKeywords: ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'],
  optInKeywords: ['START', 'YES', 'UNSTOP'],
  helpKeywords: ['HELP', 'INFO'],
  
  helpResponse: "Home2Smart: For support, call (864) 528-1475. Reply STOP to unsubscribe.",
  
  // Time restrictions (EST)
  allowedHours: { start: 7, end: 21 }, // 7am - 9pm
  
  // Rate limiting
  maxPerDay: 3,
  maxPerWeek: 10
};

// SendGrid Configuration
export const SENDGRID_CONFIG = {
  fromEmail: "contact@home2smart.com",
  fromName: "Home2Smart",
  replyTo: "contact@home2smart.com",
  
  // Notification recipients
  quoteNotifications: "h2sbackend@gmail.com",
  bookingNotifications: "h2sbackend@gmail.com",
  errorNotifications: "h2sbackend@gmail.com"
};

// Management Contact List
export const MANAGEMENT_CONTACTS = {
  // Primary dispatch/management numbers (will receive all critical alerts)
  phones: [
    "+18644502445",  // Management 1
    "+18643239776",  // Management 2
    "+19513318992",  // Management 3
    "+18643235087"   // Management 4
  ],
  
  emails: [
    "h2sbackend@gmail.com"
  ],
  
  // Alert thresholds
  highValueThreshold: 500, // Orders over $500 trigger high-value alert
  
  // Alert preferences
  notifications: {
    newBookings: true,
    highValueOrders: true,
    proAssignmentFailures: true,
    quoteRequests: true
  }
};

// Twilio Configuration
export const TWILIO_CONFIG = {
  // Messaging service for better deliverability
  useMessagingService: true,
  
  // Status callback for delivery tracking
  statusCallback: "https://h2s-backend.vercel.app/api/sms-status",
  
  // Compliance
  includeOptOut: true, // Automatically append "Reply STOP to opt out"
  
  // Fallback behavior
  fallbackToEmail: false // Don't fallback to email-to-SMS (unreliable)
};
