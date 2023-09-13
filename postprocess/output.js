var fs = require('fs');
var ttytable = require('tty-table');

function exchangeStatusWord(result) {
    if (result.status === 0) return 'PASS';
    if (result.status === 1) return 'WARN';
    if (result.status === 2) return 'FAIL';
    return 'UNKNOWN';
}

function commaSafe(str) {
    if (!str) return '';
    return str.replace(/,/g, ' ');
}

function log(msg, settings) {
    if (!settings.mocha) console.log(msg);
}

// For the console output, we don't need any state since we can write
// directly to the console.
var tableHeaders = [];
var tableRows = [];

var consoleOutputHandler = {
    writeResult: function(result, plugin, pluginKey, complianceMsg) {
        var toWrite = {
            Category: plugin.category,
            Plugin: plugin.title,
            Description: plugin.description,
            Resource: (result.resource || 'N/A'),
            Region: (result.region || 'global'),
            Status: exchangeStatusWord(result),
            Message: result.message || 'N/A'
        };

        if (complianceMsg) {
            if (tableHeaders.length !== 8) {
                tableHeaders.push({
                    value: 'Compliance'
                });
            }
            toWrite.Compliance = complianceMsg;
        }
        
        tableRows.push(toWrite);
    },

    close: function(settings) {
        // For console output, print the table
        if (settings.console == 'none') {
            console.log('INFO: Console output suppressed because "console" setting was "none"');
        } else if (settings.console == 'text') {
            tableRows.forEach(function(row){
                Object.entries(row).forEach(function(entry){
                    console.log(`${entry[0]}: ${entry[1]}`);
                });
                console.log('\n');
            });
        } else {
            const t1 = ttytable(tableHeaders, tableRows, null, {
                borderStyle: 'solid',
                borderColor: 'white',
                paddingBottom: 0,
                headerAlign: 'center',
                headerColor: 'white',
                align: 'left',
                color: 'white',
                width: '100%'
            }).render();
            if (process.argv.join('').indexOf('mocha') === -1) console.log(t1);
        }
    }
};

module.exports = {
    /**
     * Creates an output handler that writes output in the CSV format.
     * @param {fs.WriteSteam} stream The stream to write to or an object that
     * obeys the writeable stream contract.
     * @param {Object} settings The source settings object
     */
    createCsv: function(stream, settings) {
        var headers = ['category', 'title', 'description',
            'resource', 'region', 'statusWord', 'message'];
        if (settings.compliance) headers.push('compliance');
        var csvWriter = require('csv-write-stream');
        var writer = csvWriter({headers: headers});
        writer.pipe(stream);

        return {
            writer: writer,
        
            writeResult: function(result, plugin, pluginKey, complianceMsg) {
                var toWrite = [plugin.category, plugin.title, commaSafe(plugin.description),
                    (result.resource || 'N/A'),
                    (result.region || 'Global'),
                    exchangeStatusWord(result), commaSafe(result.message)];
                
                if (settings.compliance) toWrite.push(complianceMsg || '');
                
                this.writer.write(toWrite);
            },
        
            close: function() {
                this.writer.end();
                log(`INFO: CSV file written to ${settings.csv}`, settings);
            }
        };
    },

    /**
     * Creates an output handler that writes output in the JSON format.
     * @param {fs.WriteSteam} stream The stream to write to or an object that
     * obeys the writeable stream contract.
     */
    createJson: function(stream, settings) {
        var results = [];
        return {
            stream: stream,
      
            writeResult: function(result, plugin, pluginKey, complianceMsg) {
                var toWrite = {
                   // plugin: pluginKey,
                    category: plugin.category,
                    //title: plugin.title,
                    description: plugin.description,
                    resource: result.resource || 'N/A',
                    region: result.region || 'Global',
                    status: exchangeStatusWord(result),
                    message: result.message,
                    link: plugin.link,
                    recommendation: plugin.recommended_action
                };

                if (complianceMsg) toWrite.compliance = complianceMsg;
                results.push(toWrite);
            },
 
            close: function() {
                var html = '<h1>Executive Summary: </h1>';
                var pass_cnt = 0;
                var fail_cnt = 0;
                var today = new Date();
                var date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
                for (var i = 0; i < results.length; i++) {
                    if (results[i].status === 'PASS') {
                        pass_cnt += 1;
                    } else {
                        fail_cnt += 1;
                    }
                    
                }
                html += 'Automated security assessment as of '+date+'.<br>';
                html += 'The scan produced <span style="color:blue;">'+results.length+' </span> findings of which <span style="color:green;">'+pass_cnt+' passed </span> and <span style="color:red;">'+fail_cnt+' failed</span><br><br>';
                html += 'The scan does not perform the security assessment on CI/CD pipelines.<br>'
                html += 'The scan also does not assess web applications deployed on GCP services<br>'
                html += 'such as Cloud Run, App Engine, Kubernetes Engine or Compute Engine'
                html += '<h3>High level summary of the categories that were scanned</h3>';
                html += '<head><style>table, th, td { border: 1px solid black;border-collapse: collapse;}</style></head>';
                //Build Summary table
                var map = {};
                for (var i = 0; i < results.length; i++) {
                  if (results[i].category in map) {
                    if(results[i].status in map[results[i].category]){
                      map[results[i].category][results[i].status] = map[results[i].category][results[i].status] + 1;
                    }else {
                      map[results[i].category][results[i].status] = 1;
                    }
                  } else {
                    map[results[i].category] = {};
                    map[results[i].category][results[i].status] = 1;    
                  }    
                }
                html += '<table class="table table-striped">';
                html += '<tr>';
                html += '<th align="left">Category</th>';
                html += '<th style="background-color:green;"># Passes</th>';
                html += '<th style="background-color:red;"># Failures</th>';
                html += '</tr>';
                for (const row in map) {
                  html += '<tr>';
                  html += '<td>'+row+'</td>';
                  if ("PASS" in map[row]) {
                    html += '<td>'+map[row].PASS+'</td>';
                  } else {
                    html += '<td>0</td>';
                  }
                  if ("FAIL" in map[row]) {
                    html += '<td>'+map[row].FAIL+'</td>';
                  } else {
                    html += '<td>0</td>';
                  }
                }
                html += '</table>'; 
                html += '<br><br>';
                //Details table
                html += '<h3>Detailed results for every failed check for each of the above categories</h3>';
                html += '<table class="table table-striped">';
                html += '<tr>';
                //html += '<th>Plugin</th>';
                html += '<th align="left">Category</th>';
                //html += '<th>Title</th>';
                html += '<th align="left">Description</th>';
                html += '<th align="left">Resource</th>';
                html += '<th align="left">Region</th>';
                html += '<th align="left">Status</th>';
                html += '<th align="left">Message</th>';
                html += '<th align="left">Recommendation</th>';
                html += '<th align="left">Documentation Link</th>';
                //html += '<th>Compliance</th>';
                html += '</tr>';
                for (var i = 0; i < results.length; i++) {
                    html += '<tr>';
                    
                    if (results[i].status === 'FAIL') {
                    
                        //html += '<td>'+results[i].plugin+'</td>';
                        html += '<td>'+results[i].category+'</td>';
                        //html += '<td>'+results[i].title+'</td>';
                        html += '<td>'+results[i].description+'</td>';
                        html += '<td style="width:23%">'+results[i].resource+'</td>';
                        html += '<td>'+results[i].region+'</td>';
                        
                        html += '<td style="background-color:red;">'+results[i].status+'</td>';
                        
                        /*
                        if (results[i].status === 'PASS') {

                            html += '<td style="background-color:green;">'+results[i].status+'</td>';
                        } else if (results[i].status === 'FAIL') {
                            html += '<td style="background-color:red;">'+results[i].status+'</td>';
                        } else {
                            html += '<td>'+results[i].status+'</td>';
                        }
                        */
                        html += '<td>'+results[i].message+'</td>';
                        html += '<td>'+results[i].recommendation+'</td>';

                        html += '<td><a href='+results[i].link+'>'+results[i].link+'</a></td>';

                        //html += '<td>'+results[i].compliance+'</td>';
                        html += '</tr>';
                    }
                }               
                html += '</table>';            
                this.stream.write(html);
                this.stream.end();
                log(`INFO: HTML file written to ${settings.html}`, settings);
            }
        };
    },

    /***
     * Creates an output handler that writes output in the JUnit XML format.
     * 
     * This constructs the XML directly, rather than through a library so that
     * we don't need to pull in another NPM dependency. This keeps things
     * simple.
     * 
     * @param {fs.WriteStream} stream The stream to write to or an object that
     * obeys the writeable stream contract.
     */
    createJunit: function(stream, settings) {
        return {
            stream: stream,
        
            /**
             * The test suites are how we represent result - each test suite
             * maps to one plugin (more specifically the plugin key) so that
             * we group tests based on the plugin key.
             */
            testSuites: {},
        
            /**
             * Adds the result to be written to the output file.
             */
            writeResult: function(result, plugin, pluginKey) {
                var suiteName = pluginKey;
                if (!Object.prototype.hasOwnProperty.call(this.testSuites, suiteName)) {
                    // The time to report for the tests (since we don't have
                    // time for any of them.) The expected JUnit format doesn't
                    // allow for time or MS, so omit those
                    var time = (new Date()).toISOString();
                    time = time.substr(0, time.indexOf('.'));

                    this.testSuites[suiteName] = {
                        name: plugin.title + ': ' + (plugin.description || ''),
                        package: pluginKey,
                        failures: 0,
                        errors: 0,
                        testCases: [],
                        time: time
                    };
                }

                // Get the test suite that we want to add to
                var testSuite = this.testSuites[pluginKey];

                // Was this test an error or failure?
                var failure = result.status === 2 ? (result.message || 'Unexpected failure') : undefined;
                testSuite.failures += failure ? 1 : 0;
                var error = result.status > 2 ? (result.message || 'Unexpected error') : undefined;
                testSuite.errors += error ? 1 : 0;

                // Each plugin can generate multiple results, which we map as
                // one plugin to one test suite. Each result in that suite needs
                // to have enough context to be useful (even for passes), so
                // we add all of that that information at the name of the test
                var name = result.region + '; ' + (result.resource || 'N/A') + '; ' + result.message;

                testSuite.testCases.push({
                    name: name,
                    classname: pluginKey,
                    file: '',
                    line: 0,
                    failure: failure,
                    error: error
                });
            },
        
            /**
             * Closes the output handler. For this JUnit output handler, all of
             * the work happens on close since we need to know information
             * about results upfront.
             */
            close: function() {
                this.stream.write('<?xml version="1.0" encoding="UTF-8" ?>\n');
                this.stream.write('<testsuites>\n');

                var index = 0;
                for (var key in this.testSuites) {
                    this._writeSuite(this.testSuites[key], index);
                    index += 1;
                }

                this.stream.write('</testsuites>\n');
                
                this.stream.end();
                log(`INFO: JUnit file written to ${settings.junit}`, settings);
            },

            /**
             * Writes the test suite to the output stream. This should really
             * only be called internally by this class.
             * @param testSuite The test suite to write to the stream
             */
            _writeSuite: function(testSuite, index)  {
                var numTests = testSuite.testCases.length;

                this.stream.write('\t<testsuite name="' + testSuite.name +
                                  '" hostname="localhost" tests="' + numTests +
                                  '" errors="' + testSuite.errors +
                                  '" failures="' + testSuite.failures +
                                  '" timestamp="' + testSuite.time +
                                  '" time="0" package="' + testSuite.package +
                                  '" id="' + index + '">\n');

                // The schema says we must have the properties element, but it can be empty
                this.stream.write('\t\t<properties></properties>\n');
                for (var testCase of testSuite.testCases) {
                    this.stream.write('\t\t<testcase classname="' +
                                      testCase.classname +'" name="' +
                                      testCase.name + '" time="0"');

                    // If we need a child, then write that, otherwise close
                    // of the test case without creating an unnecessary text
                    // element
                    if (testCase.failure) {
                        this.stream.write('>\n\t\t\t<failure message="' +
                                          testCase.failure + '" type="none"/>\n' +
                                          '\t\t</testcase>\n');
                    } else if (testCase.error) {
                        this.stream.write('>\n\t\t\t<failure message="' +
                                          testCase.error + '" type="none"/>\n' +
                                          '\t\t</testcase>\n');
                    } else {
                        this.stream.write('/>\n');
                    }
                    
                }

                // Same thing with properties above - this just needs to exist
                // even if we don't have data (according to the schema)
                this.stream.write('\t\t<system-out></system-out>\n');
                this.stream.write('\t\t<system-err></system-err>\n');

                this.stream.write('\t</testsuite>\n');
            }
        };
    },

    /**
     * Creates an output handler that writes collection in the JSON format.
     * @param {fs.WriteSteam} stream The stream to write to or an object that
     * obeys the writeable stream contract.
     */
    createCollection: function(stream, settings) {
        var results = {};
        return {
            stream: stream,

            write: function(collection) {
                results = collection;
            },

            close: function() {
                this.stream.write(JSON.stringify(results, null, 2));
                this.stream.end();
                log(`INFO: Collection file written to ${settings.collection}`, settings);
            }
        };
    },
    /**
     * Creates an output handler depending on the arguments list as expected
     * in the command line format. If multiple output handlers are specified
     * in the arguments, then constructs a unified view so that it appears that
     * there is only one output handler.
     * 
     * @param {string[]} argv Array of command line arguments (may contain
     * arguments that are not relevant to constructing output handlers).
     * 
     * @return A object that obeys the output handler contract. This may be
     * one output handler or one that forwards function calls to a group of
     * output handlers.
     */
    create: function(settings) {
        var outputs = [];
        var collectionOutput;

        tableHeaders = [
            {
                value: 'Category',
                width: '10%',
            },
            {
                value: 'Plugin'
            },
            {
                value: 'Description'
            },
            {
                value: 'Resource'
            },
            {
                value: 'Region'
            },
            {
                value: 'Status',
                width: '10%',
                formatter: function(value) {
                    if (value === 'OK') {
                        value = this.style(value, 'bgGreen', 'black');
                    } else if (value === 'FAIL') {
                        value = this.style(value, 'bgRed', 'white');
                    } else if (value === 'WARN') {
                        value = this.style(value, 'bgYellow', 'black');
                    } else {
                        value = this.style(value, 'bgGray', 'white');
                    }
                    return value;
                }
            },
            {
                value: 'Message'
            }
        ];

        tableRows = [];

        // Creates the handlers for writing output.
        if (settings.csv) {
            var stream = fs.createWriteStream(settings.csv);
            outputs.push(this.createCsv(stream, settings));
        }

        if (settings.junit) {
            var streamJunit = fs.createWriteStream(settings.junit);
            outputs.push(this.createJunit(streamJunit, settings));
        }

        if (settings.json) {
            var streamJson = fs.createWriteStream(settings.json);
            outputs.push(this.createJson(streamJson, settings));
        }

        if (settings.collection) {
            var streamColl = fs.createWriteStream(settings.collection);
            collectionOutput = this.createCollection(streamColl, settings);
        }

        var addConsoleOutput = settings.console;

        // Write to console if specified or by default if there is not
        // other output handler specified.
        if (addConsoleOutput || outputs.length == 0) {
            outputs.push(consoleOutputHandler);
        }

        // Ignore any "OK" results - only report issues
        var ignoreOkStatus = settings.ignore_ok;

        // This creates a multiplexer-like object that forwards the
        // call onto any output handler that has been defined. This
        // allows us to simply send the output to multiple handlers
        // and the caller doesn't need to worry about that part.
        return {
            writeResult: function(result, plugin, pluginKey, complianceMsg) {
                outputs.forEach(function(output) {
                    if (!(ignoreOkStatus && result.status === 0)) {
                        output.writeResult(result, plugin, pluginKey, complianceMsg);
                    }
                });
            },

            writeCollection: function(collection, providerName) {
                if (collectionOutput) collectionOutput.write(collection, providerName);
            },

            close: function() {
                if (collectionOutput) collectionOutput.close();
                outputs.forEach(function(output) {
                    output.close(settings);
                });
            }
        };
    }
};
