/**
 * Amazon Ads — production deploy pipeline.
 *
 * What the user sees:
 *   Just click "Build Now" in Jenkins. The script handles git pull, npm
 *   install, a clean build, and a full pm2 restart. The build turns red
 *   on any failure (no silent partial deploys).
 *
 * Prerequisites on the Jenkins agent:
 *   - Node 20+ on PATH
 *   - pm2 on PATH and the `amazon-ads` process already registered
 *   - The agent has the repo checked out at the same path Jenkins expects
 *     (set in the Jenkins job config, e.g. /home/ubuntu/amazon-ads)
 */
pipeline {
  agent any

  options {
    timestamps()
    timeout(time: 15, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  triggers {
    // Auto-deploy on every push to main. Comment this out if you only
    // want manual deploys via "Build Now".
    githubPush()
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git log -1 --oneline'
      }
    }

    stage('Deploy') {
      steps {
        sh 'bash scripts/deploy.sh'
      }
    }
  }

  post {
    success {
      echo "✓ Deployed successfully. The dashboard should reflect the new code on hard refresh."
    }
    failure {
      echo "✗ Deploy failed. Check the console output above; the app is still running the previous version (pm2 didn't restart on a failed build)."
    }
  }
}
