# SkillProof — Version 4 Platform Architecture

SkillProof is an industry-to-education-to-employment platform. It is not positioned as an AI product.

## Product loop

Industry standards and skills demand -> University curriculum and competencies -> Student learning, projects, assessments, internships and evidence -> Employer discovery, assessment, internship and hiring -> Employment outcomes -> Employer feedback and graduate outcomes -> University curriculum improvement.

## Shared domain objects

Student, Competency, Evidence, Assessment, Project, Employer, Internship, Employment, Outcome, Feedback.

## Product layers

### Version 1 — Foundation
- Multi-tenant organisations and users
- Student profiles
- University programmes and courses
- Competency framework
- Projects
- Assessments
- Evidence / portfolio
- Role-based access
- Verification and administration

### Version 2 — Employment
- Employer workspace
- Industry standards
- Employer projects and challenges
- Internships and applications
- Talent discovery
- Candidate evidence
- Hiring pipeline
- Graduate tracking
- Employer feedback

### Version 3 — Institutional intelligence
- University demand dashboard
- Curriculum-to-competency mapping
- Skills gap analysis
- Programme analytics
- Outcomes tracking
- Employer feedback analysis
- Curriculum improvement actions
- Institutional reporting

### Version 4 — Network layer
- Cross-sector industry standards
- Shared competency taxonomy
- University-industry relationships
- Sector dashboards
- Cross-institution benchmarking using privacy-safe aggregates
- Employer talent discovery across participating institutions
- Standards adoption and adaptation
- Outcome feedback loops
- Public verification of selected evidence
- Platform administration and verification
- Notifications and reporting

## Technology direction

Keep the current repository's React/Vite frontend and Node/Supabase foundation while strengthening domain boundaries. Use PostgreSQL/Supabase as the system of record. Use typed API contracts, row-level security, object storage for evidence, background jobs for notifications/reporting, and a search layer when scale requires it.

Do not introduce microservices prematurely. Keep the product modular and deployable as a coherent application until actual scale justifies service extraction.

## Product design principles

- Institutional rather than consumer-social visual language.
- Dense enough for university and employer workflows, but easy to scan.
- No robot imagery, neon gradients, chat bubbles, "AI" badges, or generic AI copy.
- Prefer tables, timelines, evidence cards, competency matrices, status indicators and restrained charts.
- Human-readable language: "Skills gap", "Evidence", "Industry standard", "Employer feedback", "Curriculum action".
- Every screen should make clear who owns the information and what action can be taken.
- Mobile-responsive, but desktop-first for institutional administration.

## Commercial surfaces

University subscriptions: curriculum alignment, competency mapping, assessment, internship, outcomes and analytics.

Employer subscriptions: standards, challenges, talent discovery, assessment, internships and hiring.

Industry organisations: standards, sector competency frameworks and demand intelligence.

Enterprise services: implementation, data migration, integrations and reporting.

Students receive the core evidence profile and participation experience without making the student the primary payer.

## Version 4 success condition

The system should demonstrate a closed loop:

1. An employer publishes a standard.
2. A university maps that standard to its programme.
3. A course is linked to the competencies.
4. A student completes an assessment/project.
5. Evidence is verified.
6. The student becomes discoverable to employers.
7. The student applies for or receives an internship.
8. The internship produces an outcome and employer feedback.
9. The university sees the aggregated skills gap.
10. The university creates a curriculum improvement action.
11. The updated curriculum is visible against the same competency framework.

This loop is the product's central differentiator.
