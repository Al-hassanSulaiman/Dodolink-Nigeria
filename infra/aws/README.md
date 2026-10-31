# DodoLink on AWS (ECS Express Mode + RDS + S3)

This folder adds an AWS deployment path **next to** the Google Cloud one. Nothing
in `infra/gcp` is changed or used by AWS, and Cloud Run keeps working exactly as
before. AWS features switch on only through environment variables.

AWS App Runner is closed to new customers (since 2026-04-30). AWS recommends
**Amazon ECS Express Mode**, which is what this uses.

## What changed in the code

| Area | Change |
| --- | --- |
| Database | None. `DATABASE_CONNECTION_MODE=url` + `DATABASE_URL` (already supported) connects to RDS. |
| Media storage | `STORAGE_PROVIDER=s3` uses S3 (`src/lib/s3Storage.ts`). Unset = Google Cloud Storage as today. |
| Deploy | `.github/workflows/deploy-aws.yml` (manual only) and `infra/aws/runtime.Dockerfile`. |

Auth (Clerk), payments (Paystack), the mobile app, the schema and migrations are untouched.

## Safety settings already in the container template

* `BACKGROUND_JOBS_ENABLED=false` — **keep it false until Cloud Run's jobs are stopped.**
  Left unset it defaults to ON and would run subscription billing and account-deletion
  jobs a second time (double charges). Turn it on only at cutover.
* `MIGRATION_STAGING=false`, `MIGRATION_ALLOW_AUTH=false`.
* In URL mode the API runs its `CREATE TABLE IF NOT EXISTS` startup checks for
  `account_deletions`, `media_uploads` and the portfolio tables. They are no-ops if the tables exist.

## One-time AWS setup (you run these in AWS CloudShell or the console)

1. **S3 bucket** in your region, block public access ON. Create folders by uploading under
   `private/` and `public/`. Add a CORS rule if the web app uploads from a browser:
   allow `PUT`/`GET`/`HEAD` from `https://dodolink.com.ng` and `https://www.dodolink.com.ng`
   (compare with `infra/gcp/storage-cors.json`).
2. **ECR repository** for the image.
3. **RDS Postgres** reachable from the ECS service (same VPC; its security group allows
   port 5432 from the service's security group). Use the RDS endpoint in `DATABASE_URL`
   with `?sslmode=require`.
4. **Secrets Manager** secrets for: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
   `PAYSTACK_SECRET_KEY`, `GMAIL_APP_PASSWORD`. Copy the values from your Google Secret Manager
   yourself. Also compare `infra/aws/primary-container.template.json` against your Cloud Run
   service's environment variables and add any that are missing (for example `CLERK_PROXY_URL`).
5. **IAM roles**
   * Task execution role: `AmazonECSTaskExecutionRolePolicy` + read access to those secrets.
   * Task role (what the app uses at runtime) — S3 only:
     ```json
     { "Version": "2012-10-17", "Statement": [
       { "Effect": "Allow", "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"],
         "Resource": "arn:aws:s3:::YOUR_BUCKET/*" },
       { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::YOUR_BUCKET" } ] }
     ```
   * Infrastructure role for ECS Express Mode (see AWS docs for `ecsInfrastructureRole`).
   * GitHub OIDC role (`AWS_ROLE_ARN`): may push to ECR and run `ecs:UpdateExpressGatewayService`
     (plus `iam:PassRole` for the two ECS roles).
6. **Create the Express service once** (port 8080, health check `/api/healthz`):
   ```bash
   aws ecs create-express-gateway-service \
     --service-name dodolink \
     --infrastructure-role-arn <INFRA_ROLE_ARN> \
     --execution-role-arn <EXECUTION_ROLE_ARN> \
     --task-role-arn <TASK_ROLE_ARN> \
     --health-check-path /api/healthz \
     --cpu 512 --memory 1024 \
     --primary-container file://primary-container.json
   ```
   (`primary-container.json` = the template with placeholders filled in.)
7. Add the GitHub repository variables/secret listed at the top of the workflow file.

## Testing on a branch before `main`

1. Push the branch. Cloud Build only builds `main`, so nothing deploys to Google.
2. Run the existing tests locally or via the manual workflow's `test-and-compile` job.
3. Run **Deploy to AWS (manual)** from the Actions tab with `deploy` OFF to build and push
   the image, then ON to update the AWS service. Test against the AWS-generated URL
   (`/api/healthz`, store list, image upload and view, chat media).
4. Merge to `main` only after you approve.

## Cutover checklist (do not skip order)

1. Copy media: `rclone sync gcs:<google-bucket> s3:<aws-bucket>` (or `gsutil`/`aws s3 sync`).
   Existing objects keep working; their old ACL metadata is not copied, so they are treated
   as private (same access, only the `Cache-Control` hint differs).
2. Final database sync: pause writes on Cloud Run, `pg_dump`/`pg_restore` to RDS, verify row counts.
3. Test the AWS URL end to end with `BACKGROUND_JOBS_ENABLED=false`.
4. Point `dodolink.com.ng` DNS at the AWS service (TLS certificate in ACM first).
   The mobile apps already call `dodolink.com.ng`, so they need no rebuild.
5. Update the Paystack webhook only if its URL changes (it should not).
6. **Disable the Cloud Build trigger on `main`**, stop Cloud Run's scheduled jobs, THEN set
   `BACKGROUND_JOBS_ENABLED=true` on AWS.
7. Keep Google Cloud running for a week as rollback (DNS back to the old address).
