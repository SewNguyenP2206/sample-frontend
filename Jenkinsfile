pipeline {
  agent {
    kubernetes {
      yaml '''
        apiVersion: v1
        kind: Pod
        spec:
          containers:
          - name: jnlp
            resources:
              limits:
                cpu: "500m"
                memory: "512Mi"
              requests:
                cpu: "200m"
                memory: "256Mi"
          - name: kaniko
            image: gcr.io/kaniko-project/executor:debug
            command:
            - sleep
            args:
            - 9999999
            resources:
              limits:
                cpu: "1"
                memory: "1Gi"
              requests:
                cpu: "500m"
                memory: "512Mi"
            volumeMounts:
            - name: docker-config
              mountPath: /kaniko/.docker
          - name: git
            image: alpine/git:latest
            command:
            - sleep
            args:
            - 9999999
            resources:
              limits:
                cpu: "200m"
                memory: "256Mi"
              requests:
                cpu: "100m"
                memory: "128Mi"
          volumes:
          - name: docker-config
            secret:
              secretName: dockerhub-creds-dockerconfig
              items:
              - key: .dockerconfigjson
                path: config.json
      '''
    }
  }

  environment {
    DOCKER_REGISTRY  = 'index.docker.io'
    IMAGE_NAME       = 'sewnguyen/sample-frontend'
    MANIFESTS_REPO   = 'github.com/SewNguyenP2206/manifests-sample-frontend.git'
    MANIFESTS_VALUES = 'apps/sample-frontend/values.yaml'
    GIT_USER_EMAIL   = 'jenkins@enterprise.local'
    GIT_USER_NAME    = 'Jenkins CI'
  }

  stages {
    stage('Prepare') {
      steps {
        script {
          env.GIT_SHA   = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.GIT_BRANCH_SAFE = env.BRANCH_NAME.replaceAll('/', '-')
          env.IMAGE_TAG = "${env.GIT_BRANCH_SAFE}-${env.GIT_SHA}"
          echo "▶ Branch : ${env.BRANCH_NAME}"
          echo "▶ SHA    : ${env.GIT_SHA}"
          echo "▶ Tag    : ${env.IMAGE_TAG}"
        }
      }
    }

    stage('Validate GitHub credential') {
      steps {
        container('git') {
          script {
            try {
              withCredentials([usernamePassword(
                credentialsId: 'github-credentials',
                usernameVariable: 'GH_USER',
                passwordVariable: 'GH_TOKEN'
              )]) {
                if (!env.GH_USER?.trim() || !env.GH_TOKEN?.trim()) {
                  error('GitHub credential fields must not be empty.')
                }
              }
            } catch (Exception ignored) {
              error("Missing or invalid Jenkins credential 'github-credentials'. In Manage Jenkins > Credentials, check for duplicate IDs in global, folder, and job credentials. Add or correct a Username with password credential available to this job: ID github-credentials, Username SewNguyenP2206, Password a GitHub PAT with no spaces. Then rebuild.")
            }
          }
        }
      }
    }

    stage('Build & Push') {
      steps {
        container('kaniko') {
          sh """
            /kaniko/executor \\
              --dockerfile=Dockerfile \\
              --context=\$(pwd) \\
              --destination=${env.IMAGE_NAME}:${env.IMAGE_TAG}
          """
        }
      }
    }

    stage('Update Manifests') {
      steps {
        container('git') {
          withCredentials([usernamePassword(
            credentialsId: 'github-credentials',
            usernameVariable: 'GH_USER',
            passwordVariable: 'GH_TOKEN'
          )]) {
            sh """
              # Clone manifests repo
              git clone https://\${GH_USER}:\${GH_TOKEN}@${env.MANIFESTS_REPO} manifests
              cd manifests

              # Cập nhật image tag trong values.yaml
              sed -i 's|^  tag:.*|  tag: "${env.IMAGE_TAG}"|' ${env.MANIFESTS_VALUES}

              # Verify thay đổi
              echo "--- values.yaml sau khi update ---"
              grep -A2 "^image:" ${env.MANIFESTS_VALUES} || grep "tag:" ${env.MANIFESTS_VALUES}

              # Commit và push
              git config user.email "${env.GIT_USER_EMAIL}"
              git config user.name "${env.GIT_USER_NAME}"
              git add ${env.MANIFESTS_VALUES}
              set +e
              git diff --cached --exit-code || (
                git commit -m "chore(frontend): deploy \${IMAGE_TAG} from build #${env.BUILD_NUMBER} [skip ci]" &&
                git push https://\${GH_USER}:\${GH_TOKEN}@${env.MANIFESTS_REPO} main
              )
              RET=\$?
              set -e
              cd .. && rm -rf manifests
              exit \$RET
            """
          }
        }
      }
    }
  }

  post {
    success {
      echo "✅ Build ${env.IMAGE_TAG} pushed và manifests đã được cập nhật. ArgoCD sẽ tự deploy."
    }
    failure {
      echo "❌ Pipeline thất bại tại build #${env.BUILD_NUMBER} (${env.GIT_SHA})"
    }
    always {
      deleteDir()
    }
  }
}