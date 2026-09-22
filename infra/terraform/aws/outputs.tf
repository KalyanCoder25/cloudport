# ---------------------------------------------------------------------------
# AWS Root Outputs
# ---------------------------------------------------------------------------

output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Endpoint of the EKS Kubernetes API server."
  value       = module.eks.cluster_endpoint
}

output "vpc_id" {
  description = "ID of the VPC."
  value       = module.eks.vpc_id
}

output "kubeconfig_command" {
  description = "Run this command after terraform apply to configure kubectl."
  value       = module.eks.kubeconfig_command
}

output "cluster_iam_role_arn" {
  description = "ARN of the EKS cluster IAM role."
  value       = module.eks.cluster_iam_role_arn
}
