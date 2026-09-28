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
              secretName: harbor-creds-dockerconfig
              items:
              - key: .dockerconfigjson
                path: config.json
      '''
    }
  }

  environment {
    HARBOR_REGISTRY  = 'harbor-core.harbor.svc.cluster.local'
    IMAGE_NAME       = 'library/sample-frontend'
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

    stage('Build & Push') {
      steps {
        container('kaniko') {
          sh """
            /kaniko/executor \\
              --dockerfile=Dockerfile \\
              --context=\$(pwd) \\
              --destination=${env.HARBOR_REGISTRY}/${env.IMAGE_NAME}:${env.IMAGE_TAG} \\
              --insecure \\
              --insecure-pull \\
              --skip-tls-verify
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
              git diff --cached --exit-code || (
                git commit -m "chore(frontend): deploy \${IMAGE_TAG} from build #${env.BUILD_NUMBER} [skip ci]" &&
                git push https://\${GH_USER}:\${GH_TOKEN}@${env.MANIFESTS_REPO} main
              )
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