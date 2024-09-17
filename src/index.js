const core = require('@actions/core');
const exec = require('@actions/exec');
const { context, getOctokit } = require('@actions/github');
const fs = require('fs');

async function run() {
    try {
        const baseBranch = core.getInput("base");
        const headBranch = core.getInput("head");
        const freshSnapshot = core.getInput("fresh-shapshots")==='true';
        const includeFuzzTests = core.getInput('include-fuzz-tests')==='true';
        const includeNewContracts = core.getInput('include-new-contracts')==='true';
        const token = process.env.GITHUB_TOKEN || core.getInput("token");
        const octokit = getOctokit(token);
        const repo = context.repo.repo;
        const owner = context.repo.owner;

        const genCommit = context.payload.pull_request.head.sha;
        const comCommit = context.payload.pull_request.base.sha;

        if (freshSnapshot) {
            core.startGroup(`Generating the .gas-snapshot file from "${headBranch}"`);
            await generateGasSnapshot(headBranch, ".gas-snapshot.pr");
            core.endGroup()

            core.startGroup(`Generating the .gas-snapshot file from "${baseBranch}"`);
            await generateGasSnapshot(baseBranch, ".gas-snapshot.base");
            core.endGroup()

        } else {
            core.startGroup(`Starting the reading .gas-snapshot file from "${baseBranch}"`);
            const prSnapshot = await getGitFileContent(octokit, owner, repo, baseBranch, '.gas-snapshot');
            if (prSnapshot === null) {
                throw new Error(`prSnapshot is null`);
            }
    
            fs.writeFileSync('.gas-snapshot.pr', prSnapshot);
            core.endGroup()

            core.startGroup(`Starting the reading .gas-snapshot file from "${baseBranch}"`);
            // Fetch .gas-snapshot file from the base branch
            const baseSnapshot = await getGitFileContent(octokit, owner, repo, baseBranch, '.gas-snapshot');
            if (baseSnapshot === null) {
                throw new Error(`baseSnapshot is null`);
            }
            fs.writeFileSync('.gas-snapshot.base', baseSnapshot);
            core.endGroup()
        }

        core.startGroup("Starting the diff of the gas snapshot.");

        // Get the diff between the base and PR snapshots
        const diffSnapshot = await getDiffFileContent();
        core.endGroup();

        // Generate the report
        core.startGroup("Generating the report.")
        const report = generateReport(diffSnapshot, genCommit, comCommit, includeFuzzTests, includeNewContracts);
        core.info(`Genrated Report :\n "${report}"`)
        core.setOutput("markdown", report);

    } catch (error) {
        core.setFailed(`Action failed with error: ${error.message}`);
    }
}

async function getGitFileContent(octokit, owner, repo, ref, filePath) {
    try {
        const response = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePath,
            ref,
        });
        const fileContent = Buffer.from(response.data.content, 'base64').toString();
        return fileContent;
    } catch (err) {
        core.setFailed(`Failed to get file content: ${err}`);
        throw err;
    }
}

async function generateGasSnapshot(refBranch, fileName) {
    await exec.exec('git', ['checkout', refBranch])
    const options = {
        ignoreReturnCode: true,
        silent: true
    };
    await exec.exec('forge', ['snapshot', '--snap', fileName] , options);
}

async function getDiffFileContent() {
    let output = '';
    const options = {
        listeners: {
            stdout: (data) => {
                core.info('diff stdout:', data.toString());
                output += data.toString();
            },
        },
        ignoreReturnCode: true,
        silent: true
    };
    await exec.exec('diff', ['.gas-snapshot.base', '.gas-snapshot.pr'], options);
    return output;
}

function generateReport(diffSnapshot, genCommit, comCommit, includeFuzzTests, includeNewContracts) {
    if (!diffSnapshot || diffSnapshot.trim() === "") return "";  // Return if diffSnapshot is blank
    
    const mainTests = [];
    const prTests = [];

    const lines = diffSnapshot.split('\n').filter(line => line.trim()); // Ensure non-empty lines

    if (lines.length === 0) return "";  // Return if no valid lines are found

    lines.forEach(line => {
        if (line.startsWith('<') || line.startsWith('>')) {
            let testName;
            let gasValue;
            const isFuzzTest = line.includes('runs:');

            if (includeFuzzTests) {
                // Process both fuzz and non-fuzz tests
                if (isFuzzTest || !line.includes('gas:')) {
                    testName = line.split(' (')[0].substring(2);
                    gasValue = line.split('~: ')[1]?.replace(')', '').trim();  // Use optional chaining to avoid error
                } else {
                    testName = line.split(' (')[0].substring(2);
                    gasValue = line.split('gas: ')[1]?.replace(')', '').trim();  // Use optional chaining to avoid error
                }
            } else {
                // Only process non-fuzz tests
                if (!isFuzzTest) {
                    testName = line.split(' (')[0].substring(2);
                    gasValue = line.split('gas: ')[1]?.replace(')', '').trim();  // Use optional chaining to avoid error
                }
            }

            if (testName && gasValue) {
                if (line.startsWith('<')) {
                    mainTests.push({ testName, gasValue });
                } else if (line.startsWith('>')) {
                    prTests.push({ testName, gasValue });
                }
            }
        }
    });

    if (mainTests.length === 0 && prTests.length === 0) return ""; // Return if no tests are found

    const uniqueTests = Array.from(new Set([
        ...mainTests.map(t => t.testName),
        ...prTests.map(t => t.testName)
    ]));


        const testData = uniqueTests.map(testName => {
            const [contractName, simpleTestName] = testName.split(':');
            const mainTest = mainTests.find(t => t.testName === testName) || { gasValue: '-' };
            const prTest = prTests.find(t => t.testName === testName) || { gasValue: '-' };
            const diff = (mainTest.gasValue !== '-' && prTest.gasValue !== '-') 
                ? (parseInt(prTest.gasValue) - parseInt(mainTest.gasValue)) 
                : '-';
            
            return {
                contractName,
                testName: simpleTestName,
                mainGas: mainTest.gasValue,
                prGas: prTest.gasValue,
                diff
            };
        }).filter(entry => 
            (includeNewContracts || entry.diff !== '-') &&  entry.diff !== 0); // Include new contracts or existing ones with valid gas values

        let report = `
### Gas Snapshot Comparison Report

> Generated at commit : ${genCommit}, Compared to commit : ${comCommit}

<table>
    <tr>
        <th>Contract Name</th>
        <th>Test Name</th>
        <th>Main Gas</th>
        <th>PR Gas</th>
        <th>Diff</th>
    </tr>`;
        
    let lastContractName = '';

    // Process each test entry to generate report rows
    testData.forEach((entry, index) => {
        if (entry.contractName !== lastContractName) {
            // Calculate rowSpan for the current contract
            const rowSpan = testData.filter(t => t.contractName === entry.contractName).length;
            
            report += `
    <tr>
        <td rowspan="${rowSpan}">${entry.contractName}</td>`;
        } else {
            report += `
    <tr>`;
        }

        report += `
        <td>${entry.testName}</td>
        <td>${entry.mainGas}</td>
        <td>${entry.prGas}</td>
        <td>${entry.diff}</td>
    </tr>`;

        lastContractName = entry.contractName;
    });

    report += `
</table>
`;
    return report;
}

run();