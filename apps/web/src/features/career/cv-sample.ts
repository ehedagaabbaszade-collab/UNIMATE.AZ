import { CvDataSchema, type CvData } from "@unimate/core";

/** Sample content for template previews (gallery, compare). Never saved anywhere. */
export const SAMPLE_CV: CvData = CvDataSchema.parse({
  personal: {
    fullName: "Aysel Mammadova",
    headline: "Computer Science student",
    email: "aysel@example.com",
    phone: "+994 50 000 00 00",
    city: "Baku",
    linkedin: "https://linkedin.com/in/aysel",
    github: "https://github.com/aysel",
  },
  summary: "Third-year student who enjoys building small useful tools, working in teams and learning fast. Looking for a summer internship in software development.",
  education: [{ institution: "ADA University", degree: "BSc", field: "Computer Science", start: "2023-09", end: "2027-06", gpa: "3.7" }],
  experience: [
    {
      company: "Tech Startup",
      role: "Software intern",
      location: "Baku",
      start: "2025-06",
      end: "2025-09",
      employmentType: "internship",
      bullets: ["Built a dashboard that cut report preparation from hours to minutes.", "Wrote automated tests for the payment module."],
      achievements: ["Presented the dashboard to the whole company."],
    },
  ],
  skills: [
    { name: "TypeScript", kind: "technical", level: 4 },
    { name: "React", kind: "technical", level: 4 },
    { name: "SQL", kind: "technical", level: 3 },
    { name: "Teamwork", kind: "soft" },
  ],
  languages: [
    { name: "Azerbaijani", native: true },
    { name: "English", level: "C1" },
    { name: "Turkish", level: "B2" },
  ],
  projects: [{ name: "Campus planner", role: "Developer", description: "A study planner for university students.", tech: ["React", "Supabase"] }],
  certificates: [{ name: "Web Development", issuer: "Coursera", date: "2025-02" }],
  courses: [{ name: "Algorithms", provider: "ADA University", date: "2024" }],
  hobbies: [{ title: "Chess" }],
});
