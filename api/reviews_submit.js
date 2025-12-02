// Reviews Submission API - Accepts and stores new customer reviews with optional photos.
// Endpoint: /api/reviews/submit (POST)
//
// CONTRACT (v1):
// Input JSON body fields (web form compat):
//   name (string, required)            -> display_name
//   email (string, required)           -> customer_email
//   rating (number 1-5, required)      -> rating, stars_tech, stars_service
//   review (string, required, >=20 chars) -> review_text, comment_tech, comment_service
//   services (array|string, optional)  -> services_selected (CSV)
//   share_name ('YES'|'NO', optional)  -> show_name boolean
//   tags (array|string, optional)      -> tags (CSV)
//   photos (array of {data: base64DataURL}, optional up to MAX_REVIEW_PHOTOS)
//   pro_id (string, optional)
//   job_id (string, optional)
//   featured (boolean, optional)       -> is_featured (if column exists; else ignore)
//   visible (boolean, optional)        -> is_visible (if column exists; else ignore)
//
// Response:
//   { ok: true, review_id, inserted: true, dual_written: boolean, photos_uploaded: number }
//   or { ok:false, error, code }
//
// BEHAVIOR:
// - Validates required fields & rating range.
// - Generates review_id (rev_<timestamp>_<rand>) for continuity with legacy Sheets format.
// - Inserts into Supabase 'h2s_reviews' table using service role key (RLS bypass policy).
// - Optionally forwards to legacy Google Apps Script for dual-write if REVIEWS_SHEETS_SUBMIT_ENDPOINT set.
// - Photos: either uploads to Supabase Storage bucket (REVIEW_PHOTOS_BUCKET) if configured OR stores truncated data URLs in 'photos' column (fallback).
// - Gracefully ignores columns not present (is_visible, is_featured). If insert fails due to unknown columns, retries without them.
//
// ENV VARS required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (service role for insert)
// Optional:
//   REVIEWS_SHEETS_SUBMIT_ENDPOINT (Google Apps Script endpoint supporting action=submit_review)
//   REVIEW_PHOTOS_BUCKET (Supabase Storage bucket name for photo uploads)
//   MAX_REVIEW_PHOTOS (default 5)
//
// SECURITY NOTES:
// - Service role key must NOT be exposed client-side. Calls originate server-side only.
// - Rate limiting recommended via platform config (not implemented here).
// - Basic input trimming & length checks performed; further moderation can be layered.

import { createClient } from '@supabase/supabase-js';

const MAX_PHOTOS = Number(process.env.MAX_REVIEW_PHOTOS || 5);

function error(res, code, message, meta = {}) {
  return res.status(400).json({ ok: false, error: message, code, ...meta });
}

function genReviewId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `rev_${ts}_${rand}`;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return error(res, 'missing_env', 'Supabase service configuration missing');
  }

  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = JSON.parse(req.body); } catch (e) { /* ignore */ }
  }
  if (!body || typeof body !== 'object') {
    return error(res, 'invalid_json', 'Request body must be JSON');
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const rating = Number(body.rating || 0);
  const reviewText = String(body.review || '').trim();
  const shareName = String(body.share_name || '').toUpperCase() === 'YES';
  const servicesRaw = body.services;
  const tagsRaw = body.tags;
  const photosInput = Array.isArray(body.photos) ? body.photos : [];

  if (!name) return error(res, 'missing_name', 'Name is required');
  if (!email) return error(res, 'missing_email', 'Email is required');
  if (!rating || rating < 1 || rating > 5) return error(res, 'invalid_rating', 'Rating must be 1-5');
  if (!reviewText || reviewText.length < 20) return error(res, 'short_review', 'Review must be at least 20 characters');

  const servicesSelected = Array.isArray(servicesRaw) ? servicesRaw.join(', ') : String(servicesRaw || '').trim();
  const tags = Array.isArray(tagsRaw) ? tagsRaw.join(',') : String(tagsRaw || '').trim();

  // Process photos
  const photos = [];
  const uploadedPhotoUrls = [];
  const bucket = process.env.REVIEW_PHOTOS_BUCKET;

  if (photosInput.length) {
    for (let i = 0; i < Math.min(photosInput.length, MAX_PHOTOS); i++) {
      const p = photosInput[i];
      if (!p || typeof p !== 'object' || !p.data) continue;
      const dataUrl = String(p.data);
      // Accept data URLs only
      const match = dataUrl.match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/i);
      if (!match) {
        // Fallback: store truncated
        photos.push(dataUrl.substring(0, 80) + '...');
        continue;
      }
      const mime = match[1];
      const base64 = match[3];
      if (bucket) {
        try {
          const buffer = Buffer.from(base64, 'base64');
          const ext = mime.includes('png') ? 'png' : 'jpg';
          const objectPath = `reviews/${Date.now()}_${i}_${Math.random().toString(36).slice(2)}.${ext}`;
          const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
          const { error: uploadErr } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
            contentType: mime,
            upsert: false
          });
          if (uploadErr) {
            // Fallback to truncated storage
            photos.push(dataUrl.substring(0, 80) + '...');
          } else {
            const publicUrl = supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
            uploadedPhotoUrls.push(publicUrl);
          }
        } catch (e) {
          photos.push(dataUrl.substring(0, 80) + '...');
        }
      } else {
        photos.push(dataUrl.substring(0, 80) + '...');
      }
    }
  }

  const reviewId = genReviewId();
  const nowIso = new Date().toISOString();

  // Build payload (extended columns). Always set rating & stars_* identically
  const basePayload = {
    review_id: reviewId,
    job_id: String(body.job_id || ''),
    pro_id: String(body.pro_id || ''),
    customer_email: email,
    verified: true, // Web form submissions considered verified
    show_name: shareName,
    display_name: name,
    rating,
    stars_tech: rating,
    stars_service: rating,
    review_text: reviewText,
    comment_tech: reviewText,
    comment_service: reviewText,
    services_selected: servicesSelected,
    tags,
    photos: uploadedPhotoUrls.length ? uploadedPhotoUrls.join(',') : photos.join(','),
    helpful_count: 0,
    flag_low: rating <= 2,
    created_at: nowIso,
    timestamp_iso: nowIso,
    synced_from_sheets: false,
    last_synced_at: nowIso
  };

  // Optional visibility / featured mapping if columns exist
  const wantVisible = body.visible !== undefined ? !!body.visible : true;
  const wantFeatured = body.featured !== undefined ? !!body.featured : (rating === 5);

  // Attempt insert including visibility columns; if fails due to unknown columns retry without
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let inserted = false;
  let insertError = null;

  async function attemptInsert(payload, includeVisibility) {
    const finalPayload = { ...payload };
    if (includeVisibility) {
      finalPayload.is_visible = wantVisible;
      finalPayload.is_featured = wantFeatured;
    }
    const { error: err } = await supabase.from('h2s_reviews').insert(finalPayload, { returning: 'minimal' });
    return err;
  }

  // First try with visibility columns
  insertError = await attemptInsert(basePayload, true);
  if (insertError) {
    // If error mentions column does not exist, retry without those fields
    const msg = String(insertError.message || '').toLowerCase();
    if (msg.includes('is_visible') || msg.includes('is_featured')) {
      insertError = await attemptInsert(basePayload, false);
    }
  }

  inserted = !insertError;
  if (!inserted) {
    return error(res, 'insert_failed', 'Failed to store review', { detail: insertError.message });
  }

  // Dual-write to legacy Sheets (optional)
  let dualWritten = false;
  if (process.env.REVIEWS_SHEETS_SUBMIT_ENDPOINT) {
    try {
      const sheetsResp = await fetch(process.env.REVIEWS_SHEETS_SUBMIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_review',
          name,
          email,
          rating,
          review: reviewText,
          services: servicesRaw,
          share_name: shareName ? 'YES' : 'NO',
          tags,
          photos: photosInput,
          pro_id: body.pro_id || '',
          job_id: body.job_id || ''
        })
      });
      if (sheetsResp.ok) {
        const j = await sheetsResp.json().catch(()=>({}));
        dualWritten = !!j.ok;
      }
    } catch (e) {
      // Ignore failure
    }
  }

  return res.status(200).json({
    ok: true,
    review_id: reviewId,
    inserted: true,
    dual_written: dualWritten,
    photos_uploaded: uploadedPhotoUrls.length,
    visibility_columns_used: inserted && !(insertError)
  });
}
