
// ==UserScript==
// @name         AwsumLink with role
// @downloadURL https://improvement-ninjas.amazon.com/GreaseMonkey/awsum/awsum.user.js
// @updateURL https://improvement-ninjas.amazon.com/GreaseMonkey/awsum/awsum.user.js
// @namespace    http://tampermonkey.net/
// @version      0.1.7
// @description  AWS Links! (forked from https://jsbin.amazon.com/yowucamur.user.js)
// @author       pocheny
// @match        https://*.console.aws.amazon.com/*
// @match        https://aws.amazon.com/*
// @require      https://improvement-ninjas.amazon.com/GreaseMonkey/GM_config/GM_config.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_log
// @grant        GM_setClipboard
// @connect      access.amazon.com
// @connect      conduit.security.a2z.com
// @connect      console.aws.amazon.com
// @connect      aws.amazon.com
// @connect      tiny.amazon.com
// ==/UserScript==

/* globals describe */
(function() {
  'use strict';
  function AwsumLink() {
  }

  AwsumLink.prototype.getAccountId = function () {
    var cookies = document.cookie.split(';');
    var userInfoCookie = cookies.find(cookie => /^\s*aws-userInfo=/.test(cookie));
    if (userInfoCookie) {
      var userInfo = JSON.parse(decodeURIComponent(userInfoCookie.split('=')[1]));
      var userArn = userInfo.arn;
      var accountId = userArn.split(':')[4];
      var username = userArn.split(':')[5];
      if (username === "assumed-role/BurnerConsoleAccessClientRole-DO-NOT-DELETE/BurnerConsole") {
        console.log('Detected Burner account based on username.')
        return 'BURNER'
      }
      if (/^\d{12}$/.test(accountId)) {
        console.log('Found accountId from Cookie');
        return accountId
      }
    } else {
      //console.log('Getting AccountId');
      // Account in the dom is not correct for all accounts
      var accountId = document.getElementById("awsc-login-display-name-account").innerHTML;
      //console.log('Found AccountId: ' + accountId);
      return accountId;
    }
  };

  AwsumLink.prototype.getAccountRole = function () {
    //console.log('Getting AccountRole');
    var accountRole = (document.getElementById("awsc-login-display-name-user") || document.getElementById("nav-usernameMenu").querySelector('span > span')).innerHTML
    accountRole = accountRole.split("/")[0];
    const federatedMatch = accountRole.match(/Federated Login: (.*)/)
    if (federatedMatch) {
      accountRole = federatedMatch[1]
    }
    //console.log('Found AccountRole: ' + accountRole);
    return accountRole;
  };

  AwsumLink.prototype.getAccountName = function(accountId, accountRole, onSuccessCallback) {
    var self = this;
    self._getAccountName(accountId, accountRole, function (accountName) {
      GM_setValue('awsumlink_' + accountId, accountName)
      var fullUrl = self.createAccountLink(accountId, accountName)
      self._handleFullUrl(fullUrl, onSuccessCallback);
    })
  };

  // No side effects
  AwsumLink.prototype._getAccountName = function (accountId, accountRole, callback) {
    var self = this;
    var accountName = GM_getValue('awsumlink_' + accountId);
    if (accountName !== undefined && accountName !== null) {
      console.log('Already had accounName for ' + accountId + ': ' + accountName);
      callback(accountName)
    } else {
      console.log('Did not already have accountName for ' + accountId);
      const searchUrl = `https://conduit.security.a2z.com/api/accounts/partition/aws/accountId/${accountId}`
      console.log('Going to query: ' + searchUrl);
      GM_xmlhttpRequest({
        method: "GET",
        url: searchUrl,
        onload: function (response) {
          try {
            var accountName = self.parseAccountsFromConduitResponse(response.responseText);
            console.log('Found accountName: ' + accountName);
            callback(accountName)
          } catch (e) {
            console.log('Could not search for account name by id=' + accountId);
            console.log(e);
          }
        }
      });
    }
  }

  AwsumLink.prototype.parseAccountsFromConduitResponse = function (responseText) {
    try {
      var accountName = JSON.parse(responseText).account.name
      // console.log('Parsed accountName: ' + accountName);
    } catch (e) {
      console.error(`Could not parse response from conduit ${responseText}`)
      throw e
    }
    return accountName;
  };

  AwsumLink.prototype.createAccountLink = function (accountId, accountNameType) {
    var accountName = encodeURIComponent(accountNameType)

    var self = this;
    var url = window.location.href;
    var encoded = encodeURIComponent(url);
    //console.log('Encoded url to ' + encoded);
    var accessMode = GM_config.get('awsum_useReadOnly') ? "ReadOnly" : "Administrator";
    const fullUrl = `https://conduit.security.a2z.com/api/consoleUrl?awsAccountId=${accountId}&awsPartition=aws&sessionDuration=36000&redirect=true&policy=arn:aws:iam::aws:policy/${accessMode}Access&accountName=${accountName}&destination=${encoded}`
    //console.log('fullURL: ' + fullUrl);
    return fullUrl;
  }

  AwsumLink.prototype.createRole = function(accountRole, accountId, onSuccessCallback) {
    var self = this;
    var url = window.location.href;
    //console.log('Going to create Tiny-ify ' + url + ' with role ' + accountRole);
    var encoded = encodeURIComponent(url);
    //console.log('Encoded url to ' + encoded);
    accountId = accountId.replace(/-/g, "");
    const fullUrl = `https://conduit.security.a2z.com/api/consoleUrl?awsAccountId=${accountId}&awsPartition=aws&sessionDuration=36000&redirect=true&iamRole=arn:aws:iam::${accountId}:role/${accountRole}&destination=${encoded}`
    //console.log('fullURL: ' + fullUrl);
    self._handleFullUrl(fullUrl, onSuccessCallback);
  };

  /*
   * This method is called after we've successfully generated a full URL to the current page.
   * The extension's setting is checked to see whether we should convert the full URL to a tiny URL.
   * After performing the optional conversion, this method invokes the onSuccessCallback with the final URL (either a full or tiny URL).
   */
  AwsumLink.prototype._handleFullUrl = function(fullUrl, onSuccessCallback) {
    const useTinyLink = GM_config.get('awsum_useTinyLink');
    if (useTinyLink) {
      this._convertToTinyUrl(fullUrl, onSuccessCallback);
    } else {
      onSuccessCallback(fullUrl);
    }
  };

  AwsumLink.prototype._convertToTinyUrl = function (fullUrl, callback) {
    var encodedFullUrl = encodeURIComponent(fullUrl);
    GM_xmlhttpRequest({
      method: "GET",
      url: 'https://tiny.amazon.com/submit/url?name=' + encodedFullUrl,
      onload: function (response) {
        try {
          var tinyHTML = document.createElement('div');
          tinyHTML.innerHTML = response.responseText;
          var tinyUrl = tinyHTML.querySelector("div > table > tbody > tr:nth-child(1) > td:nth-child(2) > a").innerHTML;
          //console.log("tinyUrl: " + tinyUrl);
          callback(tinyUrl);
        } catch (e) {
          console.log('Could not parse the Tiny url response:', response);
          console.log(e);
        }
      }
    });
  };

  var addAwsumButton = function() {
    console.log('Adding Awsum Button!');
    var consoleHTML = document.getElementById("nav-menu-right") || document.getElementById("awsc-navigation__more-menu--list");
    var sep = document.createElement('div');
    sep.setAttribute('class',"nav-menu-separator");
    sep.innerHTML = '&nbsp;';
    consoleHTML.appendChild(sep);
    var awsumNode = document.createElement('a');
    awsumNode.setAttribute('id', "awsum");
    awsumNode.setAttribute('class',"nav-elt nav-menu");
    awsumNode.setAttribute('style',"color: #d5dbdb; font-size: 12px");
    var awsumDiv = document.createElement('div');
    awsumDiv.setAttribute('class',"nav-elt-label");
    awsumDiv.innerHTML = "Awsum!";
    awsumNode.appendChild(awsumDiv);
    consoleHTML.appendChild(awsumNode);
    document.getElementById("awsum").addEventListener(
      "click",
      event => {
        console.log('Building AwsumLink!');
        awsumDiv.innerHTML = "Working...";
        var awsumLink = new AwsumLink();
        var accountId = awsumLink.getAccountId();
        var accountRole = awsumLink.getAccountRole();
        function onSuccessCallback(url) {
          function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
          }
          GM_setClipboard(url);
          awsumDiv.innerHTML = "Copied!";
          sleep(2000).then(() => awsumDiv.innerHTML = "Awsum!");
        }
        // conduitAccessClientRole is old access for access.amazon.com
        // IibsAdminAccess is access for conduit.security.a2z
        if (accountRole === "ConduitAccessClientRole-DO-NOT-DELETE" || accountRole === 'IibsAdminAccess-DO-NOT-DELETE') {
          // Typical Conduit login
          awsumLink.getAccountName(accountId, accountRole, onSuccessCallback);
        } else {
          // Conduit role login
          awsumLink.createRole(accountRole, accountId, onSuccessCallback);
        }
      },
      false
    );
  };

  function setUpDisclaimer () {
    const awsumLink = new AwsumLink()
    const accountId = awsumLink.getAccountId()
    const accountRole = awsumLink.getAccountRole()
    var accessMode = GM_config.get('awsum_useReadOnly') ? "ReadOnly" : "Administrator";
    const url = window.location.href
    const encodedURL = encodeURIComponent(url)
    // console.log('Going to create Tiny-ify ' + url + ' with account ' + accountName);
    const normalizedResource = normalizeResource(url)

    if (!normalizedResource) {
      console.log('url did not belong to a specific resource or resource type (lambda, cloudformation...) was not supported', url)
      return
    }

    const encoded = encodeURIComponent(normalizedResource.id)
    const key = 'awssumlink_' + encoded
    const savedValue = GM_getValue(key)
    let parsedSavedValue = null
    if (!savedValue) {
      console.log('There was no saved value for resource')
      awsumLink._getAccountName(accountId, accountRole, function (accountName) {
        GM_setValue(key, JSON.stringify({
          accountId: accountId,
          accountRole: accountRole,
          accountName: accountName
        }))
      })
      return
    }
    try {
      parsedSavedValue = JSON.parse(savedValue)
    } catch (e) {
      console.log('Could not parse key for saved value', e)
      return
    }
    const savedAccountName = parsedSavedValue.accountName
    if (!savedAccountName) {
      console.error('Saved value did not contain account name, erasing')
      GM_setValue(key, null)
      return
    }
    // Open link on different account
    if (parsedSavedValue.accountId !== accountId) {
      console.log('Account did not match the one exiting. Offering to change')
      const div = document.createElement('div')
      div.innerHTML = `
      <div class="awsum-recovery"
      style="    
      position: absolute;
      margin: 10px;
      padding: 10px;
      right: 10px;
      top: 20px;
      display: inline-block;
      width: 300px;
      border-style: ridge;
      border-width: 2px;
      border-color: #555;
      background: cornsilk;
      z-index: 2000;
      border-radius: 2px;"
      >
        <span> Resource was previously open in account: </span><span id="awsum-account-name"></span>. Do you want to load previous account
        <div class="awsum-recovery-buttons">
          <button id="awsum-open-button">Open</button>
          <button id="awsum-discard-button">Discard</button>
        </div>
      </div>
      `
      div.querySelector('#awsum-account-name').textContent = parsedSavedValue.accountName
      div.querySelector('#awsum-open-button').addEventListener('click', function () {
        window.location.href = `https://conduit.security.a2z.com/api/consoleUrl?awsAccountId=${parsedSavedValue.accountId}&awsPartition=aws&sessionDuration=36000&redirect=true&policy=arn:aws:iam::aws:policy/${accessMode}Access&accountName=${savedAccountName}&destination=${encodedURL}`
        div.remove()
      })
      div.querySelector('#awsum-discard-button').addEventListener('click', function () {
        awsumLink._getAccountName(accountId, accountRole, function (accountName) {
          console.log('Saving value for future visits')
          GM_setValue(key, JSON.stringify({
            accountId: accountId,
            accountRole: accountRole,
            accountName: accountName
          }))
        })
        div.remove()
      })
      document.body.appendChild(div)
    } else {
      console.log('Resource had already been visited before')
    }
  }

  /**
  Returns normalized url if url points to resource, false if not
  @return {{type: string, id: string, description: string}}
   */
  function normalizeResource (url) {
    const parsedUrl = new URL(url)
    // s3
    // "https://s3.console.aws.amazon.com/s3/home?region=eu-west-1#"
    // "https://s3.console.aws.amazon.com/s3/buckets/bucket-example-id-eu/?region=eu-west-1"
    if (url.match('https?://s3.console.aws.amazon.com/')) {
      const s3Match = url.match('https?://s3.console.aws.amazon.com/s3/buckets/(.*)/')
      if (!s3Match) {
        console.log('url belonged to s3 but matched no resource', url)
        return null
      }
      console.log('There was s3 match', s3Match[1])
      return {
        type: 's3',
        description: `S3 Bucket: ${s3Match[1]}`,
        bucket: s3Match[1],
        id: `s3:${s3Match[1]}`
      }
    }
    // "https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#"
    // all alarms https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#alarmsV2:?~(alarmStateFilter~'ALARM)
    // one cloud watch group
    // https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#logStream:group=/aws/codebuild/myLoggroup
    // one alarm
    // https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#alarmsV2:alarm/some-alarm?~(alarmStateFilter~'ALARM)
    if (url.match('https?://.*.console.aws.amazon.com/cloudwatch/home')) {
      if (!parsedUrl.hash) {
        console.log('cloudwatch detected, but there was no hash on the url, so it points to no resource', url)
        return null
      }
      console.log('Cloud watch url detected')
      if (!(parsedUrl.hash.startsWith('#alarmsV2:alarm') || parsedUrl.hash.startsWith('#logStream:group')|| parsedUrl.hash.startsWith('#logEventViewer'))) {
        console.log('It was cloudwatch url but no log group or alarm detected', parsedUrl)
        return
      }
      return {
        type: 'cloudwatch',
        description: `Cloudwatch elem: ${parsedUrl.hash}`,
        logGroup: parsedUrl.hash,
        id: `cloudwatch:${parsedUrl.hash}`
      }
    }
    // all lambdas
    // "https://eu-west-1.console.aws.amazon.com/lambda/home?region=eu-west-1#/functions"
    // "https://eu-west-1.console.aws.amazon.com/lambda/home?region=eu-west-1#/functions/someLambda?tab=configuration"
    if (url.match('https?://.*.console.aws.amazon.com/lambda/')) {
      if (!(parsedUrl.hash && parsedUrl.hash.match(/#\/functions\/(.*)\?/))) {
        console.log('Url belonged to lambda but no resource found', url)
        return null
      }
      const id = parsedUrl.hash.match(/#\/functions\/(.*)\?/)[1]
      console.log('lambda detected', id)
      return {
        type: 'lambda',
        description: `Lambda function ${id}`,
        lambda: id,
        id: `lambda:${id}`
      }
    }

    // all stacks
    // "https://eu-west-1.console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks?filteringText=&filteringStatus=active&viewNested=true&hideStacks=false"
    // "https://eu-west-1.console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks/stackinfo?filteringText=&filteringStatus=active&viewNested=true&hideStacks=false&stackId=arn%3Aaws%3Acloudformation%3Aeu-west-1%3A23424%3Astack%cloud-stack-name%2F76d43120-3123-11e9-a947-1231oinswasd"
    if (url.match('https?://.*.console.aws.amazon.com/cloudformation/home')) {
      console.log(parsedUrl.hash, parsedUrl.hash.startsWith('#/stacks'))
      if (!(parsedUrl.hash && parsedUrl.hash.startsWith('#/stacks/stackinfo'))) {
        console.log('Url belonged to cloudformation but it did not represent a particular resource', url)
        return null
      }
      let stackId
      try {
        const params = new URLSearchParams(parsedUrl.hash)
        if (params && params.get('stackId')) {
          stackId = params.get('stackId')
        }
      } catch (e) {
        console.error('Could not parse search params for cloudwatch', e)
        return null
      }
      if (!stackId) {
        console.log('url belonged to cloudwatch but it contained no stack id', url)
        return null
      }
      console.log('cloudformation detected', stackId)
      return {
        type: 'cloudformation',
        description: `Cloudformation stack: ${stackId}`,
        stack: stackId,
        id: `cloudformation:${stackId}`
      }
    }

    // "https://eu-west-1.console.aws.amazon.com/codesuite/codepipeline/pipelines?region=eu-west-1&pipelines-state=%7B%22f%22%3A%7B%22text%22%3A%22%22%7D%2C%22s%22%3A%7B%22property%22%3A%22updated%22%2C%22direction%22%3A-1%7D%2C%22n%22%3A10%2C%22i%22%3A0%7D"
    // "https://eu-west-1.console.aws.amazon.com/codesuite/codepipeline/pipelines/some_pipeline/view?region=eu-west-1"
    if (url.match('https?://.*.console.aws.amazon.com/codesuite/codepipeline')) {
      if (!(parsedUrl.pathname && parsedUrl.pathname.match('/codesuite/codepipeline/(.*)/'))) {
        console.log('URL matched code pipelined but contained no resource', url)
        return null
      }
      const urlmatch = parsedUrl.pathname.match('/codesuite/codepipeline/(.*)/')
      console.log('code pipeline detected', urlmatch[1])
      return {
        type: 'codepipeline',
        description: `Code pipeline: ${urlmatch[1]}`,
        pipeline: urlmatch[1],
        id: `codepipeline:${urlmatch[1]}`
      }
    }
    console.log('URL did not match known pattern', url)
    return null
  }

  if (typeof window !== 'undefined') {
    // Configure the settings panel provided by GM_config (https://github.com/sizzlemctwizzle/GM_config/wiki)
    GM_config.init({
      id: 'AwsumConfig',
      title: 'Awsum Settings',
      fields: {
        awsum_useTinyLink: {
          label: 'Generate tiny URLs',
          type: 'checkbox',
          default: true
        },
        awsum_useReadOnly: {
          label: 'Generate ReadOnly URLs',
          type: 'checkbox',
          default: false
        }
      },
      events: {
        open: () => {
          GM_config.frame.setAttribute('style', [
            'height: 165px',
            'width: 350px',
            'position: fixed',
            'top: 40px',
            'right: 0px',
            'z-index: 2000'
          ].join(';'))
        },
        save: GM_config.close
      },
      'css': [
        '#AwsumConfig { margin: auto; margin-top: 10px; height: 90%; width: 90%; background-color: #232F3E; color: white; z-index: 2000; }',
        '#AwsumConfig_resetLink.reset { color: #E9E9ED; }'
      ].join(' ')
    });

    GM_registerMenuCommand('Awsum Settings', () => GM_config.open());

    addAwsumButton();
    setUpDisclaimer()
    window.addEventListener('hashchange', function () {
      // top code is only loaded on a new reload, but we need to load it every time that we navigate
      setUpDisclaimer()
    })

  } else {
    const {expect} = require('chai')
    // Node run tests
    describe('awsum tests', function () {
      describe('Normalizer test', function () {
        const examples = [
          { url: "https://s3.console.aws.amazon.com/s3/home?region=eu-west-1#", id: null},
          { url: "https://s3.console.aws.amazon.com/s3/buckets/bucket-example-id-eu/?region=eu-west-1", id: 's3:bucket-example-id-eu'},
          { url: "https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#", id: null},
          { url: "https://eu-west-1.console.aws.amazon.com/lambda/home?region=eu-west-1#/functions", id: null},
          { url: "https://eu-west-1.console.aws.amazon.com/lambda/home?region=eu-west-1#/functions/someLambda?tab=configuration", id: 'lambda:someLambda'},
          { url: "https://eu-west-1.console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks?filteringText=&filteringStatus=active&viewNested=true&hideStacks", id: null},
          { url: "https://eu-west-1.console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks/stackinfo?filteringText=&filteringStatus=active&viewNested=true&hideStacks=false&stackId=arn%3Aaws%3Acloudformation%3Aeu-west-1%3A23424%3Astack%cloud-stack-name%2F76d43120-3123-11e9-a947-1231oinswasd", id: 'cloudformation:arn:aws:cloudformation:eu-west-1:23424:stack%cloud-stack-name/76d43120-3123-11e9-a947-1231oinswasd'},
          { url: "https://eu-west-1.console.aws.amazon.com/codesuite/codepipeline/pipelines?region=eu-west-1&pipelines-state=%7B%22f%22%3A%7B%22text%22%3A%22%22%7D%2C", id: null},
          { url: "https://eu-west-1.console.aws.amazon.com/codesuite/codepipeline/pipelines/some_pipeline/view?region=eu-west-1", id: 'codepipeline:pipelines/some_pipeline'},
          { url: "https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#logStream:group=/aws/codebuild/myLoggroup", id: 'cloudwatch:#logStream:group=/aws/codebuild/myLoggroup'},
          { url: "https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#alarmsV2:alarm/some-alarm?~(alarmStateFilter~'ALARM)", id: 'cloudwatch:#alarmsV2:alarm/some-alarm?~(alarmStateFilter~\'ALARM)'},
          { url: 'https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#logEventViewer:group=BookDepositoryMarketplaceBrokerService/application.log;filter=%22GetFeedSubmissionList%22%20%22ERROR%22;start=PT1H', id: 'cloudwatch:#logEventViewer:group=BookDepositoryMarketplaceBrokerService/application.log;filter=%22GetFeedSubmissionList%22%20%22ERROR%22;start=PT1H'}
        ]
        for (const test of examples) {
          ;(test.only ? it.only : it)(test.url, function () {
            const result = normalizeResource(test.url)
            const id = !result ? null : result.id
            expect(id).equal(test.id)
          })
        }
      })
    })
  }
})();

