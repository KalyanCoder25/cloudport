# ---------------------------------------------------------------------------
# EKS Module Outputs
# ---------------------------------------------------------------------------

output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = aws_eks_cluster.main.name
}

output "cluster_endpoint" {
  description = "Endpoint of the EKS Kubernetes API server."
  value       = aws_eks_cluster.main.endpoint
}

output "cluster_certificate_authority" {
  description = "Base64-encoded certificate authority data for the EKS cluster."
  value       = aws_eks_cluster.main.certificate_authority[0].data
  sensitive   = true
}

output "cluster_version" {
  description = "Kubernetes version of the EKS cluster."
  value       = aws_eks_cluster.main.version
}

output "vpc_id" {
  description = "ID of the VPC created for the EKS cluster."
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets (worker nodes)."
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets (load balancers, NAT)."
  value       = aws_subnet.public[*].id
}

output "node_group_name" {
  description = "Name of the EKS managed node group."
  value       = aws_eks_node_group.main.node_group_name
}

output "kubeconfig_command" {
  description = "AWS CLI command to configure kubectl context. Run this after terraform apply."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${aws_eks_cluster.main.name} --alias aws-eks-cloudport"
}

output "cluster_iam_role_arn" {
  description = "ARN of the IAM role for the EKS cluster."
  value       = aws_iam_role.eks_cluster.arn
}

output "node_iam_role_arn" {
  description = "ARN of the IAM role for the EKS node group."
  value       = aws_iam_role.eks_nodes.arn
}
