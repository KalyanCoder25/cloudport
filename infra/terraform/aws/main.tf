# ---------------------------------------------------------------------------
# AWS Provider Root — CloudPort Capstone EKS
#
# Usage:
#   cd infra/terraform/aws
#   cp terraform.tfvars.example terraform.tfvars   # fill in real values
#   terraform init
#   terraform fmt -check
#   terraform validate
#   terraform plan                                 # review before applying
#   terraform apply                                # requires explicit approval
#
# CREDENTIAL SAFETY:
#   Never put AWS access keys in terraform.tfvars or .env.
#   Use one of:
#     1. AWS CLI profile: export AWS_PROFILE=your-profile
#     2. IAM Identity Center (SSO): aws sso login
#     3. Environment variables: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
#        (set in shell session only, never in source files)
#
# COST SAFETY:
#   terraform apply provisions real AWS resources that incur charges.
#   Run `terraform plan` first. Use `bash ../destroy-aws.sh` to clean up.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Backend configuration: uncomment and configure for team use.
  # For capstone solo use, local state is acceptable — but never commit .tfstate.
  # backend "s3" {
  #   bucket         = "your-terraform-state-bucket"
  #   key            = "cloudport-capstone/aws/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "terraform-lock"
  # }
}

provider "aws" {
  region = var.region

  # Tags applied to every resource created by this provider root
  default_tags {
    tags = {
      Project     = "cloudport-capstone"
      Environment = "capstone"
      ManagedBy   = "terraform"
      Capstone    = "cloudport-multicloud"
    }
  }
}

# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------

data "aws_availability_zones" "available" {
  state = "available"
}

# ---------------------------------------------------------------------------
# EKS Module
# ---------------------------------------------------------------------------

module "eks" {
  source = "../modules/eks"

  project_name = var.project_name
  environment  = var.environment
  region       = var.region

  availability_zones = slice(data.aws_availability_zones.available.names, 0, 3)

  vpc_cidr             = var.vpc_cidr
  private_subnet_cidrs = var.private_subnet_cidrs
  public_subnet_cidrs  = var.public_subnet_cidrs

  kubernetes_version = var.kubernetes_version
  node_instance_type = var.node_instance_type
  node_desired_count = var.node_desired_count
  node_min_count     = var.node_min_count
  node_max_count     = var.node_max_count
  node_disk_size_gb  = var.node_disk_size_gb

  cluster_name_override = var.cluster_name_override

  cluster_endpoint_public_access       = var.cluster_endpoint_public_access
  cluster_endpoint_public_access_cidrs = var.cluster_endpoint_public_access_cidrs

  tags = {
    KubernetesContext = "aws-eks-cloudport"
  }
}
