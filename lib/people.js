// How a person is named in exports and pickers. Kept apart from
// lib/personalExport.js so code (and tests) can use it without pulling in
// Firebase.
export const personName = (u) => (u ? (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email) : "Unknown");
