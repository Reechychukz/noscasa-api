const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS_AHEAD = Number(process.env.BOOKING_MIN_DAYS_AHEAD || '2');
const MAX_LOOKAHEAD_DAYS = Number(process.env.BOOKING_MAX_LOOKAHEAD_DAYS || '90');
const MAX_NIGHTS = Number(process.env.BOOKING_MAX_NIGHTS || '30');

function parseDateOnly(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date) {
  return date?.toISOString().split('T')[0] || null;
}

function getEarliestCheckIn() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + MIN_DAYS_AHEAD);
  return date;
}

function getLatestBookingDate() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + MAX_LOOKAHEAD_DAYS);
  return date;
}

function validateBookingDates(checkIn, checkOut) {
  const checkInDate = parseDateOnly(checkIn);
  const checkOutDate = parseDateOnly(checkOut);

  if (!checkInDate || !checkOutDate) {
    return { valid: false, error: 'Select valid check-in and check-out dates.' };
  }

  const earliest = getEarliestCheckIn();
  const latest = getLatestBookingDate();

  if (checkInDate < earliest) {
    return { valid: false, error: `Check-in must be at least ${MIN_DAYS_AHEAD} days from today.` };
  }

  if (checkInDate > latest) {
    return { valid: false, error: `Check-in must be within the next ${MAX_LOOKAHEAD_DAYS} days.` };
  }

  if (checkOutDate <= checkInDate) {
    return { valid: false, error: 'Check-out must be after check-in.' };
  }

  if (checkOutDate > latest) {
    return { valid: false, error: `Check-out must be within the next ${MAX_LOOKAHEAD_DAYS} days.` };
  }

  const nights = Math.round((checkOutDate - checkInDate) / DAY_MS);
  if (nights > MAX_NIGHTS) {
    return { valid: false, error: `Bookings can be at most ${MAX_NIGHTS} nights.` };
  }

  return {
    valid: true,
    checkIn: formatDateOnly(checkInDate),
    checkOut: formatDateOnly(checkOutDate),
    nights,
  };
}

function validatePricingQuery(query) {
  const { checkIn, checkOut, guests, listingId, listing_id } = query;
  const effectiveListingId = listingId || listing_id;

  if (!effectiveListingId) {
    return { valid: false, error: 'Missing listingId/listing_id.' };
  }

  if (!guests || Number.isNaN(Number(guests)) || Number(guests) < 1) {
    return { valid: false, error: 'Please provide a valid guest count.' };
  }

  const dateValidation = validateBookingDates(checkIn, checkOut);
  if (!dateValidation.valid) return dateValidation;

  return {
    valid: true,
    listingId: effectiveListingId,
    guests: Number(guests),
    checkIn: dateValidation.checkIn,
    checkOut: dateValidation.checkOut,
    nights: dateValidation.nights,
  };
}

function validateAvailabilityQuery(query) {
  const { from, to, listingId, listing_id } = query;
  const effectiveListingId = listingId || listing_id || process.env.GUESTY_LISTING_ID;

  if (!effectiveListingId) {
    return { valid: false, error: 'Missing listingId/listing_id.' };
  }

  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (!fromDate || !toDate) {
    return { valid: false, error: 'Select valid from/to dates.' };
  }

  if (toDate <= fromDate) {
    return { valid: false, error: 'The availability end date must be after the start date.' };
  }

  const latest = getLatestBookingDate();
  if (fromDate > latest || toDate > latest) {
    return { valid: false, error: `Availability must be within the next ${MAX_LOOKAHEAD_DAYS} days.` };
  }

  return {
    valid: true,
    listingId: effectiveListingId,
    from: formatDateOnly(fromDate),
    to: formatDateOnly(toDate),
  };
}

function validateReservationPayload(body) {
  const { checkIn, checkOut, guests, guest, pricing, notes, paymentIntentId, bookingRef, listingId, listing_id } = body;
  const effectiveListingId = listingId || listing_id || process.env.GUESTY_LISTING_ID;

  if (!effectiveListingId) {
    return { valid: false, error: 'Missing listingId/listing_id.' };
  }

  if (!paymentIntentId) {
    return { valid: false, error: 'Missing paymentIntentId.' };
  }

  if (!bookingRef) {
    return { valid: false, error: 'Missing bookingRef.' };
  }

  if (!guest || !guest.firstName?.trim() || !guest.lastName?.trim() || !guest.email?.trim()) {
    return { valid: false, error: 'Please provide guest first name, last name, and email.' };
  }

  if (!pricing || typeof pricing.totalPrice !== 'number' || pricing.totalPrice <= 0) {
    return { valid: false, error: 'Invalid pricing details.' };
  }

  if (!guests || Number.isNaN(Number(guests)) || Number(guests) < 1) {
    return { valid: false, error: 'Guest count must be at least 1.' };
  }

  const dateValidation = validateBookingDates(checkIn, checkOut);
  if (!dateValidation.valid) return dateValidation;

  return {
    valid: true,
    listingId: effectiveListingId,
    guests: Number(guests),
    guest,
    notes,
    paymentIntentId,
    bookingRef,
    checkIn: dateValidation.checkIn,
    checkOut: dateValidation.checkOut,
    pricing,
  };
}

module.exports = {
  validateBookingDates,
  validatePricingQuery,
  validateAvailabilityQuery,
  validateReservationPayload,
  getEarliestCheckIn,
};
