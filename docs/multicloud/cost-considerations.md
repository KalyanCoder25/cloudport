# CloudPort Multi-Cloud Capstone — Cost Considerations

> [!CAUTION]
> AWS EKS and GCP GKE provision real cloud resources that incur **real charges**.
> This page documents estimated costs and cost controls.
> `terraform apply` is **never run automatically** — all provisioning requires explicit operator approval.

## Estimated Monthly Costs

The following estimates are approximate. Actual costs depend on region, usage, and pricing changes.

### AWS EKS Estimate

| Resource | Configuration | Estimated Cost/month |
|---|---|---|
| EKS control plane | 1 cluster | ~$73 |
| EC2 worker nodes | 3× t3.medium (on-demand) | ~$90 |
| NAT Gateway | 1× (single-AZ) | ~$32 |
| ELB (load balancer) | Created by Online Boutique frontend service | ~$18 |
| EBS (storage) | 20 GB × 3 nodes | ~$6 |
| Data transfer | Locust load tests | ~$2–5 |
| **TOTAL** | | **~$220/month** |

### GCP GKE Estimate

| Resource | Configuration | Estimated Cost/month |
|---|---|---|
| GKE control plane | Regional cluster | ~$72 |
| Compute worker nodes | 3× e2-medium (on-demand) | ~$60 |
| Cloud NAT | 1× | ~$15 |
| Cloud Load Balancer | Created by Online Boutique frontend service | ~$18 |
| Persistent Disk | 30 GB × 3 nodes | ~$6 |
| Data transfer | Locust load tests | ~$2–5 |
| **TOTAL** | | **~$173/month** |

### Combined Capstone Estimate

**~$390–$400/month if both clusters run for a full month.**

For a time-boxed capstone experiment (e.g., 5 days of active use):
- **AWS**: ~$36
- **GCP**: ~$29
- **Combined**: ~$65 for 5 days

## Cost Controls

### 1. Do Not Run Both Clusters Simultaneously Unless Testing

Provision AWS, complete all AWS trials, then provision GCP, complete GCP trials, then destroy AWS.
Or provision both simultaneously but only for the duration of the actual experiment.

### 2. Use Single-AZ NAT (already configured)

The Terraform modules use a **single NAT gateway** instead of one per AZ.
This saves ~$32–$64/month at the cost of cross-AZ NAT traffic.
Acceptable for a time-boxed capstone.

### 3. Destroy After Experiments

```bash
# Run immediately after completing all trials
bash infra/terraform/destroy-aws.sh
bash infra/terraform/destroy-gcp.sh
```

Verify destruction:
```bash
aws eks list-clusters --region ap-south-1     # should show empty list
gcloud container clusters list               # should show empty list
```

### 4. Use Spot Instances / Preemptible VMs (optional cost reduction)

For non-critical load testing, you can reduce costs by using spot/preemptible nodes.
**Not configured by default** (stability preferred for reproducible experiments):

```hcl
# AWS — in modules/eks/main.tf, add to node group:
capacity_type = "SPOT"  # 60-90% cost reduction, but nodes can be evicted

# GCP — in modules/gke/main.tf, add to node config:
spot = true  # 60-91% cost reduction, but nodes can be preempted
```

Do not use spot/preemptible nodes if you need guaranteed uptime during Locust trials.

### 5. Billing Alerts

Set up billing alerts before provisioning:

**AWS:**
```bash
aws budgets create-budget --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget '{"BudgetName":"cloudport-capstone","BudgetType":"COST","TimeUnit":"MONTHLY","BudgetLimit":{"Amount":"100","Unit":"USD"}}' \
  --notifications-with-subscribers '[{"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80},"Subscribers":[{"SubscriptionType":"EMAIL","Address":"your@email.com"}]}]'
```

**GCP:**
```bash
# Set up billing budget via GCP Console → Billing → Budgets & alerts
# Or use: gcloud billing budgets create ...
```

### 6. terraform plan Before terraform apply

Always review the plan before applying. Look for unexpected resources:

```bash
cd infra/terraform/aws && terraform plan | grep -E "(+ create|~ update|- destroy)"
cd infra/terraform/gcp && terraform plan | grep -E "(\+ create|~ update|- destroy)"
```

## Free Tier Eligibility

- **AWS**: EKS control plane is **not covered** by Free Tier ($0.10/hour).
- **GCP**: GKE Autopilot has a free tier, but standard GKE clusters as used here are **not free**.
- Neither EC2 t3.medium nor e2-medium instances qualify for new-account Free Tier at the count used here.

## Cost Responsibility

> [!WARNING]
> Cloud costs are the operator's responsibility. CloudPort's codebase creates
> Terraform configuration only. `terraform apply` is never run automatically.
> Destroy resources when experiments are complete.
